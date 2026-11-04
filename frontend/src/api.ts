const productionApi = 'https://soilsense-gz6h.onrender.com';
const requested = import.meta.env.VITE_API_URL?.trim();
// A localhost value carried over from local setup cannot work on Vercel.
const configured = import.meta.env.PROD
  ? (requested?.startsWith('https://') ? requested : productionApi)
  : (requested || 'http://localhost:3001');
export const API_BASE = configured.replace(/\/$/, '');
const SESSION_KEY = 'soilsense.session';
export function saveSession(token: string) { sessionStorage.setItem(SESSION_KEY, token); }
export function clearSession() { sessionStorage.removeItem(SESSION_KEY); }
export async function apiFetch(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  const token = sessionStorage.getItem(SESSION_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  try {
    return await fetch(`${API_BASE}${path}`, {...options, headers, credentials:'omit', signal:options.signal ?? AbortSignal.timeout(15000)});
  } catch {
    throw new Error(`Cannot reach the backend at ${API_BASE}. Start the backend and check VITE_API_URL and FRONTEND_ORIGIN.`);
  }
}
export async function downloadDeviceConfig() {
  const response = await apiFetch('/api/device-config');
  if (!response.ok) throw new Error(response.status === 401 ? 'Your session expired. Please sign in again.' : 'Could not download the device configuration.');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url; link.download = 'config.h'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
