/**
 * API client + escaping helpers.
 *
 * Every call carries the session cookie (the auth gate is a real server check —
 * a 401 here means the session lapsed, so we bounce back to the lock screen).
 */

const TIMEOUT_MS = 20000;

/** Escape untrusted text before it goes anywhere near innerHTML. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, raw, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  if (signal) signal.addEventListener('abort', () => controller.abort());

  const headers = { Accept: 'application/json' };
  const init = {
    method,
    credentials: 'same-origin',
    signal: controller.signal,
    headers,
  };

  if (raw instanceof Blob) {
    // Send the file as the request body. Deliberately NOT FormData: a
    // multipart body makes PHP write a temp file, which we don't want.
    // A File/Blob body streams without loading into memory.
    headers['Content-Type'] = raw.type || 'application/octet-stream';
    init.body = raw;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new ApiError('timeout', 'That took too long. Check your connection.', 0);
    }
    throw new ApiError('network', "Couldn't reach the server.", 0);
  }
  clearTimeout(timer);

  let payload = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok || (payload && payload.ok === false)) {
    const code = payload?.error?.code ?? 'http_error';
    const message = payload?.error?.message ?? 'Something went wrong.';
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    throw new ApiError(code, message, res.status);
  }

  return payload?.data ?? null;
}

export const api = {
  get: (p, o) => request(p, { ...o, method: 'GET' }),
  post: (p, body, o) => request(p, { ...o, method: 'POST', body }),
  patch: (p, body, o) => request(p, { ...o, method: 'PATCH', body }),
  del: (p, body, o) => request(p, { ...o, method: 'DELETE', body }),
  /** Send a File/Blob as the raw request body (never multipart). */
  send: (p, blob, o) => request(p, { ...o, method: 'POST', raw: blob }),
};

/* ------------------------------------------------------------------ *
 * Endpoint wrappers — one per route, so call sites stay readable.
 * ------------------------------------------------------------------ */

export const authApi = {
  status: () => api.get('/api/auth'),
  login: (passcode) => api.post('/api/auth', { passcode }),
  logout: () => api.post('/api/auth/logout', {}),
  bootstrap: (setupToken, payload) =>
    api.post('/api/auth-bootstrap', payload, { headers: { 'x-setup-token': setupToken } }),

  /**
   * Change the passcode.
   *
   * POST rather than PATCH /api/settings, because it needs the CURRENT passcode
   * as proof and the server deliberately keeps passcode_hash out of the
   * settings document — mixing it into a settings patch would let anyone who
   * can reach the endpoint rewrite the lock without knowing the old code.
   */
  changePasscode: ({ current_passcode, new_passcode }) =>
    api.post('/api/settings', { current_passcode, new_passcode }),
};

export const cardsApi = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/api/cards${q ? `?${q}` : ''}`);
  },
  create: (card) => api.post('/api/cards', card),
  update: (card) => api.patch('/api/cards', card),
  remove: (id) => api.del('/api/cards', { id }),
};

export const calendarApi = {
  range: (from, to) => api.get(`/api/calendar?from=${from}&to=${to}`),
  create: (ev) => api.post('/api/calendar', ev),
  update: (ev) => api.patch('/api/calendar', ev),
  remove: (id) => api.del('/api/calendar', { id }),
};

export const decksApi = {
  all: () => api.get('/api/decks'),
  create: (card) => api.post('/api/decks', card),
  update: (card) => api.patch('/api/decks', card),
  remove: (id) => api.del('/api/decks', { id }),
};

export const tracksApi = {
  list: () => api.get('/api/tracks'),
  create: (track) => api.post('/api/tracks', track),
  remove: (id) => api.del('/api/tracks', { id }),
};

export const settingsApi = {
  get: () => api.get('/api/settings'),
  update: (patch) => api.patch('/api/settings', patch),
};

export const uploadApi = {
  /**
   * Upload a File as the raw request body.
   * @param {File|Blob} file
   * @param {'photo'|'audio'} kind
   * @param {string} [variant] e.g. 'card' | 'original' | 'audio'
   */
  image: (file, kind = 'photo', variant = 'card') => {
    const q = new URLSearchParams({ kind });
    if (variant) q.set('variant', variant);
    return api.send(`/api/upload?${q}`, file);
  },
  audio: (file) => api.send(`/api/upload?kind=audio`, file),

  /**
   * Upload media directly to Supabase, bypassing Vercel.
   *
   * Vercel rejects function request bodies over 4.5 MB *before PHP runs*, so a
   * 5 MB mp3 can never go through /api/upload — the rejection happens at the
   * platform level, not ours, and raising our own limit changes nothing. We ask
   * the server for a short-lived signed URL and PUT the bytes straight to
   * Supabase instead.
   *
   * @param {File} file
   * @param {string} [kind]
   * @param {AbortSignal} [signal]
   * @param {(fraction:number)=>void} [onProgress] 0..1
   */
  sendDirect: async (file, kind = 'audio', { signal, onProgress } = {}) => {
    const signed = await api.post(
      `/api/upload-signed?kind=${encodeURIComponent(kind)}`,
      {
        filename: file.name ?? 'upload',
        mime: file.type || 'application/octet-stream',
        bytes: file.size,
      },
      { signal },
    );

    const target = `${signed.upload_url}?token=${encodeURIComponent(signed.token)}`;

    // The server's canonical type, NOT file.type. Browsers report aliases
    // (audio/x-m4a, audio/mp3) that the bucket's allowlist does not list, and
    // Supabase rejects the PUT if the content_type is not on that list.
    const contentType = signed.content_type || file.type || 'application/octet-stream';

    // XHR rather than fetch: fetch still cannot report UPLOAD progress, and the
    // progress bar is what separates "hanging" from "working" on a 6 MB file
    // over a phone connection.
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', target);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.setRequestHeader('x-upsert', 'false');

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(1);
          resolve();
        } else {
          // Supabase reports the real reason in the body — surface it instead
          // of a bare status code, otherwise a rejected content-type looks like
          // an arbitrary network failure.
          let detail = '';
          try {
            detail = JSON.parse(xhr.responseText).message ?? '';
          } catch {
            /* non-JSON error body; the status alone is all we have */
          }
          if (xhr.status === 413) {
            reject(new Error('That file is larger than the storage limit (50 MB).'));
          } else if (/mime|content.?type/i.test(detail)) {
            reject(new Error("That file's format isn't accepted. Try MP3, M4A, OGG or WAV."));
          } else {
            reject(new Error(detail || `Upload failed (HTTP ${xhr.status}).`));
          }
        }
      });

      xhr.addEventListener('error', () => reject(new Error("Couldn't reach the storage service.")));
      xhr.addEventListener('abort', () => reject(new Error('Upload cancelled.')));

      if (signal) signal.addEventListener('abort', () => xhr.abort());

      xhr.send(file);
    });

    return { url: signed.url, path: signed.path };
  },

  remove: (path) => api.del('/api/upload', { path }),
};