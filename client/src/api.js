export const getToken = () => localStorage.getItem('acr_token');
export const setToken = (t) => (t ? localStorage.setItem('acr_token', t) : localStorage.removeItem('acr_token'));

export async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && path !== '/login') { setToken(null); location.reload(); }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const err = new Error(j.error || 'เกิดข้อผิดพลาด');
    err.code = j.code;
    err.status = r.status;
    throw err;
  }
  return r.status === 204 ? null : r.json();
}
