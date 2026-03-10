import { getToken } from "./auth.js";
import { getBookDetails } from "../opds/api.js";
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

  const safeTitle = entry.title.replace(/[<>:"/\\|?*]/g, "").trim();
  const author = entry.authors[0]?.name ?? "Unknown";
  const safeAuthor = author.replace(/[<>:"/\\|?*]/g, "").trim();
  const fileName = `${safeAuthor} — ${safeTitle}${ext}`;

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

  const boundary = `----PBUpload${Date.now()}`;
  const fileBytes = new Uint8Array(fileData);

  const headerStr =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;
  const footerStr = `\r\n--${boundary}--\r\n`;

  const headerBytes = new TextEncoder().encode(headerStr);
  const footerBytes = new TextEncoder().encode(footerStr);

  const body = new Uint8Array(
    headerBytes.length + fileBytes.length + footerBytes.length
  );
  body.set(headerBytes, 0);
  body.set(fileBytes, headerBytes.length);
  body.set(footerBytes, headerBytes.length + fileBytes.length);

  const res = await fetch(`${API_BASE}/books`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `PocketBook Cloud upload failed (${res.status}): ${text}`
    );
  }
}

export async function uploadBookFromOpds(bookId: string): Promise<UploadResult> {
  const entry = await getBookDetails(bookId);
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

  const effectiveMime = contentType !== "application/octet-stream"
    ? contentType
    : acqLink.mimeType;

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
