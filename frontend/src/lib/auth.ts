const STORAGE_KEY = "forgely_api_key";

/** Store API key in localStorage (base64 encoded) */
export function saveApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, btoa(key));
}

/** Retrieve stored API key (decoded) */
export function getApiKey(): string | null {
  const encoded = localStorage.getItem(STORAGE_KEY);
  if (!encoded) return null;
  try {
    return atob(encoded);
  } catch {
    return null;
  }
}

/** Remove stored API key */
export function clearApiKey(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Wrapper around fetch that injects the X-Api-Key header */
export async function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const key = getApiKey();
  const headers = new Headers(opts.headers);
  if (key) {
    headers.set("X-Api-Key", key);
  }
  return fetch(url, { ...opts, headers });
}
