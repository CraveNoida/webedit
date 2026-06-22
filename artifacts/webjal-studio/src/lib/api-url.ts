const DEFAULT_API_BASE_URL = "https://webedit-api.onrender.com";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, "");

export function apiUrl(path: string): string {
  if (/^(?:https?:|data:|blob:)/i.test(path)) return path;
  return path.startsWith("/") ? `${API_BASE_URL}${path}` : `${API_BASE_URL}/${path}`;
}

export { API_BASE_URL };
