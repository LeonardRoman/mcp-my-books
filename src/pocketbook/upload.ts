import { getToken } from "./auth.js";
import { getBookDetails, searchCatalog } from "../opds/api.js";
import type { OpdsEntry } from "../opds/types.js";

const API_BASE = "https://cloud.pocketbook.digital/api/v1.0";

interface UploadResult {
  success: boolean;
  message: string;
  bookTitle: string;
  bookAuthor: string;
  fileName: string;
}

function getOpdsBaseUrl(): string {
  const url = process.env.OPDS_URL?.trim();
  if (!url) throw new Error("OPDS_URL не задан");
  return url.replace(/\/$/, "");
}

const TRANSLIT: Record<string, string> = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',
  к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
  х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
};

function transliterate(text: string): string {
  return text
    .split("")
    .map((c) => {
      const lower = c.toLowerCase();
      if (lower in TRANSLIT) {
        const t = TRANSLIT[lower];
        return c === lower ? t : t.charAt(0).toUpperCase() + t.slice(1);
      }
      return c;
    })
    .join("")
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "_")
    .trim();
}

function normalizeMime(mime: string): string {
  if (mime.includes("fb2") || mime.includes("fictionbook"))
    return "application/x-fictionbook+xml";
  if (mime.includes("epub")) return "application/epub+zip";
  return mime;
}

function resolveAcquisitionLink(entry: OpdsEntry): {
  url: string;
  mimeType: string;
  fileName: string;
} | null {
  const preferred = ["application/epub+zip", "application/fb2+zip", "application/x-fictionbook+xml"];
  const acqLinks = entry.links.filter(
    (l) => l.rel && l.rel.includes("acquisition")
  );

  if (acqLinks.length === 0) return null;

  let chosen = acqLinks[0];
  for (const pref of preferred) {
    const match = acqLinks.find((l) => l.type === pref);
    if (match) {
      chosen = match;
      break;
    }
  }

  const baseUrl = getOpdsBaseUrl();
  const href = chosen.href.startsWith("http")
    ? chosen.href
    : `${baseUrl}${chosen.href.startsWith("/") ? "" : "/"}${chosen.href}`;

  const ext = chosen.type?.includes("epub")
    ? ".epub"
    : chosen.type?.includes("fb2") || chosen.type?.includes("fictionbook")
      ? ".fb2"
      : ".epub";

  const safeTitle = transliterate(entry.title);
  const author = entry.authors[0]?.name ?? "Unknown";
  const safeAuthor = transliterate(author);
  const fileName = `${safeAuthor}_-_${safeTitle}${ext}`;

  return {
    url: href,
    mimeType: chosen.type ?? "application/octet-stream",
    fileName,
  };
}

async function downloadBook(url: string): Promise<{ data: ArrayBuffer; contentType: string }> {
  const res = await fetch(url, {
    headers: { Accept: "application/epub+zip, application/fb2+zip, application/octet-stream" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`Не удалось скачать книгу (${res.status}): ${url}`);
  }
  const data = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  return { data, contentType };
}

async function uploadToPocketBook(
  fileData: ArrayBuffer,
  fileName: string,
  mimeType: string
): Promise<void> {
  const token = await getToken();

  const res = await fetch(
    `${API_BASE}/files/${encodeURIComponent(fileName)}?access_token=${token}`,
    {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: fileData,
    }
  );

  if (res.status === 409) return;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `PocketBook Cloud upload failed (${res.status}): ${text}`
    );
  }
}

/**
 * Find an OPDS entry by ID. First tries direct lookup (cache + root catalog),
 * then falls back to text search using provided hint (title/author),
 * then constructs a minimal entry from the download URL as last resort.
 *
 * @param bookId - OPDS entry ID (e.g. "book:813532" or "813532")
 * @param searchHint - optional title or author text to search by (for cold-cache scenarios)
 */
async function findEntry(bookId: string, searchHint?: string): Promise<OpdsEntry | null> {
  const idNorm = bookId.startsWith("book:") ? bookId : `book:${bookId}`;
  const numericId = idNorm.replace(/^book:/, "");

  // 1. Direct lookup (cache + root catalog)
  const direct = await getBookDetails(bookId);
  if (direct) return direct;

  // 2. Fallback: text search using hint (title/author from prior search)
  const searchTerms = searchHint ? [searchHint] : [];
  // Also try numeric ID as search term (some servers support it)
  searchTerms.push(numericId);

  for (const term of searchTerms) {
    try {
      const feed = await searchCatalog(term);
      const hit = feed.entries.find(
        (e) => e.id === idNorm || e.id === bookId || e.id === numericId
      );
      if (hit) return hit;
    } catch {
      // Search failed, try next term
    }
  }

  // 3. Last resort: construct minimal entry with download link
  const baseUrl = getOpdsBaseUrl();
  try {
    const controller = new AbortController();
    const checkRes = await fetch(`${baseUrl}/download/${numericId}`, {
      headers: { Range: "bytes=0-0" },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    });
    controller.abort();
    if (checkRes.ok || checkRes.status === 206) {
      return {
        id: idNorm,
        title: searchHint ?? `Book ${numericId}`,
        authors: [],
        categories: [],
        links: [{
          rel: "http://opds-spec.org/acquisition",
          href: `/download/${numericId}`,
          type: "application/fb2",
        }],
      };
    }
  } catch {
    // Not reachable
  }

  return null;
}

export async function uploadBookFromOpds(bookId: string, searchHint?: string): Promise<UploadResult> {
  const entry = await findEntry(bookId, searchHint);
  if (!entry) {
    return {
      success: false,
      message: `Книга с ID «${bookId}» не найдена в OPDS`,
      bookTitle: "",
      bookAuthor: "",
      fileName: "",
    };
  }

  const acqLink = resolveAcquisitionLink(entry);
  if (!acqLink) {
    return {
      success: false,
      message: `У книги «${entry.title}» нет ссылок для скачивания`,
      bookTitle: entry.title,
      bookAuthor: entry.authors[0]?.name ?? "",
      fileName: "",
    };
  }

  const { data, contentType } = await downloadBook(acqLink.url);

  const rawMime = contentType !== "application/octet-stream"
    ? contentType
    : acqLink.mimeType;
  const effectiveMime = normalizeMime(rawMime);

  await uploadToPocketBook(data, acqLink.fileName, effectiveMime);

  return {
    success: true,
    message: `Книга «${entry.title}» загружена в PocketBook Cloud`,
    bookTitle: entry.title,
    bookAuthor: entry.authors[0]?.name ?? "",
    fileName: acqLink.fileName,
  };
}

export function formatUploadResult(result: UploadResult): string {
  if (!result.success) {
    return `Ошибка: ${result.message}`;
  }
  const lines = [
    result.message,
    `  Автор: ${result.bookAuthor}`,
    `  Файл: ${result.fileName}`,
  ];
  return lines.join("\n");
}
