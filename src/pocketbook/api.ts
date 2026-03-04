import { getToken } from "./auth.js";
import type { PbBook, PbBooksResponse } from "./types.js";

const API_BASE = "https://cloud.pocketbook.digital/api/v1.0";

let booksCache: { books: PbBook[]; ts: number } | null = null;
const CACHE_TTL_MS = 60_000;

async function fetchAllBooks(): Promise<PbBook[]> {
  if (booksCache && Date.now() - booksCache.ts < CACHE_TTL_MS) {
    return booksCache.books;
  }
  const token = await getToken();
  const res = await fetch(`${API_BASE}/books?limit=10000`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(
      `PocketBook books failed (${res.status}): ${await res.text()}`
    );
  }
  const data: PbBooksResponse = await res.json();
  const books = data.items ?? [];
  booksCache = { books, ts: Date.now() };
  return books;
}

function normalizeReadStatus(status: string): string {
  const s = (status ?? "").toLowerCase();
  if (s === "read" || s === "finished" || s === "completed" || s === "done")
    return "finished";
  if (s === "reading" || s === "in_progress") return "reading";
  return s;
}

/** Дата последнего обновления позиции чтения (для сортировки «последняя открытая»). */
function lastReadAt(b: PbBook): number {
  const fromPosition = b.position?.updated || b.read_position?.updated;
  if (fromPosition) return new Date(fromPosition).getTime();
  if (b.action_date) return new Date(b.action_date).getTime();
  return 0;
}

export async function getReadingBooks(): Promise<{
  books: PbBook[];
  totalCount: number;
}> {
  const all = await fetchAllBooks();
  const filtered = all.filter((b) => {
    const status = normalizeReadStatus(b.read_status);
    if (status !== "reading") return false;
    const percent = b.read_percent ?? (b.position?.percent ?? 0);
    if (percent >= 100) return false;
    return true;
  });
  filtered.sort((a, b) => lastReadAt(b) - lastReadAt(a));
  return { books: filtered, totalCount: filtered.length };
}

export async function getFinishedBooks(): Promise<{
  books: PbBook[];
  totalCount: number;
}> {
  const all = await fetchAllBooks();
  const filtered = all.filter((b) => {
    const status = normalizeReadStatus(b.read_status);
    if (status === "finished") return true;
    const percent = b.read_percent ?? (b.position?.percent ?? 0);
    return percent >= 100;
  });
  filtered.sort((a, b) => lastReadAt(b) - lastReadAt(a));
  return { books: filtered, totalCount: filtered.length };
}

export async function getAllBooks(): Promise<{
  books: PbBook[];
  totalCount: number;
}> {
  const books = await fetchAllBooks();
  return { books, totalCount: books.length };
}

export function formatPbBook(b: PbBook): string {
  const title = b.metadata?.title || b.title || b.name;
  const authors = b.metadata?.authors ?? "";
  const parts = [`"${title}"${authors ? ` — ${authors}` : ""}`];
  if (b.read_percent !== undefined && b.read_percent > 0) {
    parts.push(`Прогресс: ${Math.min(b.read_percent, 100)}%`);
  }
  if (b.position?.pages_total) {
    parts.push(`Страниц: ${b.position.pages_total}`);
  }
  if (b.format) parts.push(`Формат: ${b.format}`);
  parts.push("Источник: PocketBook Cloud");
  return parts.join("\n");
}
