<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/http.php';

/**
 * Input validation.
 *
 * Every field that reaches SQL or the database goes through here. The rules are
 * deliberately strict: a CHECK constraint in Postgres is the last line of
 * defence, not the first, and a clear 400 beats a constraint violation.
 */

final class ValidationError extends RuntimeException
{
    /** @var array<string,string> */
    public array $errors;

    public function __construct(array $errors)
    {
        $this->errors = $errors;
        parent::__construct(implode(' ', $errors));
    }
}

/** Collects field errors, then throws them all at once. */
final class Validator
{
    /** @var array<string,string> */
    private array $errors = [];

    public function __construct(private array $input)
    {
    }

    public function has(string $field): bool
    {
        return array_key_exists($field, $this->input);
    }

    public function raw(string $field): mixed
    {
        return $this->input[$field] ?? null;
    }

    /** A trimmed string with length bounds. Optional when $required is false. */
    public function text(string $field, int $max, bool $required = true, int $min = 1): self
    {
        $value = $this->input[$field] ?? null;

        if ($value === null || $value === '') {
            if ($required) {
                $this->errors[$field] = 'This field is required.';
            }
            return $this;
        }
        if (!is_string($value)) {
            $this->errors[$field] = 'Expected text.';
            return $this;
        }

        $value = trim($value);
        $length = mb_strlen($value);

        if ($length < $min) {
            $this->errors[$field] = $min === 1
                ? 'This field is required.'
                : sprintf('Must be at least %d characters.', $min);
            return $this;
        }
        if ($length > $max) {
            $this->errors[$field] = sprintf('Must be %d characters or fewer.', $max);
            return $this;
        }
        // Strip control characters that would corrupt a JSON payload.
        $clean = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', $value) ?? $value;
        $this->input[$field] = $clean;

        return $this;
    }

    /** Strict YYYY-MM-DD, validated against the real calendar. */
    public function date(string $field, bool $required = false): self
    {
        $value = $this->input[$field] ?? null;

        if ($value === null || $value === '') {
            if ($required) {
                $this->errors[$field] = 'Please choose a date.';
            }
            return $this;
        }
        if (!is_string($value) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m)) {
            $this->errors[$field] = 'Use a date like 2024-02-14.';
            return $this;
        }

        // new DateTime rolls 2024-13-01 into the next year, so check the
        // components survived the round trip.
        if (!checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            $this->errors[$field] = "That date doesn't exist.";
            return $this;
        }

        $this->input[$field] = $value;
        return $this;
    }

    public function uuid(string $field, bool $required = true): self
    {
        $value = $this->input[$field] ?? null;

        if ($value === null || $value === '') {
            if ($required) {
                $this->errors[$field] = 'This field is required.';
            }
            return $this;
        }
        if (!is_string($value) || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value)) {
            $this->errors[$field] = 'That identifier is not valid.';
            return $this;
        }

        $this->input[$field] = strtolower($value);
        return $this;
    }

    /** Whitelist against the database CHECK constraint's value list. */
    public function enum(string $field, array $allowed, bool $required = true): self
    {
        $value = $this->input[$field] ?? null;

        if ($value === null || $value === '') {
            if ($required) {
                $this->errors[$field] = 'Please choose an option.';
            }
            return $this;
        }
        if (!is_string($value) || !in_array($value, $allowed, true)) {
            $this->errors[$field] = 'That option is not valid.';
            return $this;
        }

        $this->input[$field] = $value;
        return $this;
    }

    /** An absolute http(s) URL. */
    public function url(string $field, bool $required = true): self
    {
        $value = $this->input[$field] ?? null;

        if ($value === null || $value === '') {
            if ($required) {
                $this->errors[$field] = 'This field is required.';
            }
            return $this;
        }
        if (!is_string($value) || !preg_match('#^https?://#i', $value)) {
            $this->errors[$field] = 'That must be a link starting with http:// or https://.';
            return $this;
        }
        if (strlen($value) > 2000) {
            $this->errors[$field] = 'That link is too long.';
            return $this;
        }

        $this->input[$field] = $value;
        return $this;
    }

    /** Integer with optional bounds. */
    public function int(string $field, int $default = 0, ?int $min = null, ?int $max = null): self
    {
        $value = $this->input[$field] ?? null;

        if ($value === null || $value === '') {
            $this->input[$field] = $default;
            return $this;
        }
        if (!is_numeric($value)) {
            $this->errors[$field] = 'Expected a number.';
            return $this;
        }

        $int = (int) $value;
        if ($min !== null && $int < $min) {
            $int = $min;
        }
        if ($max !== null && $int > $max) {
            $int = $max;
        }
        $this->input[$field] = $int;

        return $this;
    }

    /** Store a validated value under a different key (for partial updates). */
    public function set(string $field, mixed $value): self
    {
        $this->input[$field] = $value;
        return $this;
    }

    public function unset(string $field): self
    {
        unset($this->input[$field]);
        return $this;
    }

    public function fails(): bool
    {
        return $this->errors !== [];
    }

    /** @return array<string,string> */
    public function errors(): array
    {
        return $this->errors;
    }

    /** @return array cleaned values, with unset() removals applied */
    public function values(): array
    {
        return $this->input;
    }
}

/** Turn a ValidationError into the standard 400 envelope. */
function fail_validation(array $errors): never
{
    $first = (string) (reset($errors) ?: 'Please check the form.');
    json_error('validation_failed', $first, 422, $errors);
}