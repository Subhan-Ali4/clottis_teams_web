let unauthorizedHandler = null;
export const setUnauthorizedHandler = (fn) => { unauthorizedHandler = fn; };

export class ApiError extends Error {
  // `data` is the JSON error body: `fields` (per-field messages), `code`
  // (VALIDATION_ERROR / VERSION_CONFLICT) and, on a conflict, `current` (latest task).
  constructor(status, message, data = {}) {
    super(message);
    this.status = status;
    this.fields = data.fields || null;
    this.code = data.code || null;
    this.current = data.current || null;
  }
}

// `silent401`: a 401 here is an expected answer (not logged in / wrong credentials),
// not a sign that an existing session has ended.
async function request(method, url, body, { silent401 = false } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }

  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }

  if (!res.ok) {
    if (res.status === 401 && !silent401) unauthorizedHandler?.();
    throw new ApiError(res.status, data?.error || 'Something went wrong. Please try again.', data || {});
  }
  return data;
}

export const api = {
  me: () => request('GET', '/api/auth/me', undefined, { silent401: true }),
  login: (email, password) => request('POST', '/api/auth/login', { email, password }, { silent401: true }),
  logout: () => request('POST', '/api/auth/logout'),
  changePassword: (currentPassword, newPassword) =>
    request('POST', '/api/auth/change-password', { currentPassword, newPassword }),

  listUsers: () => request('GET', '/api/users'),
  createUser: (body) => request('POST', '/api/users', body),
  resetPassword: (id) => request('POST', `/api/users/${id}/reset-password`),
  setActive: (id, isActive) => request('PATCH', `/api/users/${id}/status`, { isActive }),

  // Tasks and board
  listProjects: () => request('GET', '/api/projects'),
  directoryUsers: () => request('GET', '/api/directory/users'),
  listTasks: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    return request('GET', `/api/tasks${q.toString() ? `?${q}` : ''}`);
  },
  getTask: (id) => request('GET', `/api/tasks/${id}`),
  createTask: (body) => request('POST', '/api/tasks', body),
  updateTask: (id, body) => request('PATCH', `/api/tasks/${id}`, body),
  moveTask: (id, body) => request('POST', `/api/tasks/${id}/move`, body),
};
