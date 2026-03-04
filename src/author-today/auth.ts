const API_BASE = "https://api.author.today/v1";

const GUEST_HEADERS = {
  Authorization: "Bearer guest",
  "Content-Type": "application/json",
};

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

export async function login(): Promise<string> {
  const { login, password } = getCredentials();

  const res = await fetch(`${API_BASE}/account/login-by-password`, {
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

  const res = await fetch(`${API_BASE}/account/refresh-token`, {
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
