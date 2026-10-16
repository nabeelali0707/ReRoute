export const money = (n: number) => new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(n);

// The operator token lives in session storage so a refresh keeps the workspace open.
let token = sessionStorage.getItem('reroute-token') || '';
export const getToken = () => token;
export function setToken(value: string) {
  token = value;
  if (value) sessionStorage.setItem('reroute-token', value); else sessionStorage.removeItem('reroute-token');
}
export const authHeaders = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Please check the form values and try again.');
  }
  return res.json();
}
