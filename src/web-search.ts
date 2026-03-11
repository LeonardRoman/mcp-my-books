import { stripHtml } from "./author-today/api.js";

const TIMEOUT_MS = 10_000;

function fetchWithTimeout(url: string, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id));
}

// ---------------------------------------------------------------------------
// Google Books API
// ---------------------------------------------------------------------------

interface GoogleBooksVolume {
  volumeInfo?: {
    title?: string;
    authors?: string[];
    description?: string;
  };
}

async function searchGoogleBooks(title: string, author: string): Promise<string> {
  const q = encodeURIComponent(`intitle:${title} inauthor:${author}`);
  const url = `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=3&langRestrict=ru`;

  const res = await fetchWithTimeout(url);
  if (!res.ok) return "";

  const data = (await res.json()) as { items?: GoogleBooksVolume[] };
  if (!data.items?.length) return "";

  for (const item of data.items) {
    const desc = item.volumeInfo?.description;
    if (desc && desc.length > 20) {
      return stripHtml(desc);
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Open Library API
// ---------------------------------------------------------------------------

async function searchOpenLibrary(title: string, author: string): Promise<string> {
  const params = new URLSearchParams({ title, author, limit: "3" });
  const searchUrl = `https://openlibrary.org/search.json?${params}`;

  const res = await fetchWithTimeout(searchUrl);
  if (!res.ok) return "";

  const data = (await res.json()) as {
    docs?: { key?: string; first_sentence?: string[] }[];
  };
  if (!data.docs?.length) return "";

  for (const doc of data.docs) {
    if (!doc.key) continue;

    try {
      const workRes = await fetchWithTimeout(`https://openlibrary.org${doc.key}.json`);
      if (!workRes.ok) continue;

      const work = (await workRes.json()) as {
        description?: string | { value?: string };
      };

      const raw =
        typeof work.description === "string"
          ? work.description
          : work.description?.value ?? "";

      if (raw.length > 20) return stripHtml(raw);
    } catch {
      continue;
    }
  }

  return "";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function searchBookDescription(
  title: string,
  author: string,
): Promise<string> {
  try {
    const desc = await searchGoogleBooks(title, author);
    if (desc) return desc;
  } catch {
    // Google Books unavailable — fall through
  }

  try {
    return await searchOpenLibrary(title, author);
  } catch {
    return "";
  }
}
