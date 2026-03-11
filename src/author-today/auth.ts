const API_BASE = "https://api.author.today/v1";

const GUEST_HEADERS = {
  Authorization: "Bearer guest",
  "Content-Type": "application/json",
};

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 9000];

let cachedToken: string | null = null;

export function getCredentials(): { login: string; password: string } {
  const login = process.env.AT_LOGIN;
  const password = process.env.AT_PASSWORD;
  if (!login || !password) {
    throw new Error(
      "AT_LOGIN and AT_PASSWORD environment variables are required"
    );
  }
  return { login, password };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.status === 429 && attempt < retries - 1) {
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10);
        console.error(`Rate limited (429), retrying after ${retryAfter + 1}s...`);
        await sleep((retryAfter + 1) * 1000);
        continue;
      }

      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      if (attempt === retries - 1) throw err;
      const delay = RETRY_DELAYS[attempt] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
      console.error(
        `AT fetch attempt ${attempt + 1}/${retries} failed: ${
          err instanceof Error ? err.message : String(err)
        }. Retrying in ${delay}ms...`
      );
      await sleep(delay);
    }
  }
  throw new Error("fetchWithRetry: unreachable");
}

export async function login(): Promise<string> {
  const { login, password } = getCredentials();

  const res = await fetchWithRetry(`${API_BASE}/account/login-by-password`, {
    method: "POST",
    headers: GUEST_HEADERS,
    body: JSON.stringify({ login, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Login failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = data.token;
  return data.token;
}

export async function refreshToken(): Promise<string> {
  if (!cachedToken) return login();

  const res = await fetchWithRetry(`${API_BASE}/account/refresh-token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cachedToken}` },
  });

  if (!res.ok) {
    cachedToken = null;
    return login();
  }

  const data = await res.json();
  cachedToken = data.token;
  return data.token;
}

export async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  return login();
}

export function clearToken(): void {
  cachedToken = null;
}
