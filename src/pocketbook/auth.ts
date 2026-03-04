import type { PbProvider, PbToken } from "./types.js";

const API_BASE = "https://cloud.pocketbook.digital/api/v1.0";
const DEFAULT_CLIENT_ID = "qNAx1RDb";
const DEFAULT_CLIENT_SECRET =
  "K3YYSjCgDJNoWKdGVOyO1mrROp3MMZqqRNXNXTmh";

let cachedToken: string | null = null;

export function getCredentials(): {
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
} {
  const username = process.env.PB_USERNAME;
  const password = process.env.PB_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "PB_USERNAME and PB_PASSWORD environment variables are required"
    );
  }
  return {
    username,
    password,
    clientId: process.env.PB_CLIENT_ID ?? DEFAULT_CLIENT_ID,
    clientSecret: process.env.PB_CLIENT_SECRET ?? DEFAULT_CLIENT_SECRET,
  };
}

export async function getProviders(): Promise<PbProvider[]> {
  const { username, clientId, clientSecret } = getCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    username,
  });
  const res = await fetch(`${API_BASE}/auth/login?${params}`);
  if (!res.ok) {
    throw new Error(`PocketBook providers failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.providers ?? [];
}

export async function login(): Promise<string> {
  const { username, password, clientId, clientSecret } = getCredentials();
  const providers = await getProviders();
  if (providers.length === 0) {
    throw new Error("PocketBook: no login providers returned");
  }
  const provider = providers[0];
  const form = new URLSearchParams({
    shop_id: provider.shop_id,
    username,
    password,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "password",
  });
  const res = await fetch(`${API_BASE}/auth/login/${provider.alias}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) {
    throw new Error(
      `PocketBook login failed (${res.status}): ${await res.text()}`
    );
  }
  const data: PbToken = await res.json();
  cachedToken = data.access_token;
  return data.access_token;
}

export async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  return login();
}

export function clearToken(): void {
  cachedToken = null;
}
