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

async function request(path, { method = 'GET', body, form, signal } = {}) {
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

  if (form) {
    init.body = form; // let the browser set the multipart boundary
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
  upload: (p, form, o) => request(p, { ...o, method: 'POST', form }),
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
  image: (file, variant) => {
    const form = new FormData();
    form.append('photo', file);
    if (variant) form.append('variant', variant);
    return api.upload('/api/upload', form);
  },
  /** Audio upload — same streaming endpoint, wider allowlist, no crop step. */
  audio: (file) => {
    const form = new FormData();
    form.append('audio', file);
    return api.upload('/api/upload', form);
  },
  remove: (path) => api.del('/api/upload', { path }),
};