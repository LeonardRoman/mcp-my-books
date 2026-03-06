import { XMLParser } from "fast-xml-parser";
import type { OpdsFeed, OpdsEntry, OpdsLink, OpdsAuthor } from "./types.js";

const CACHE_TTL_MS = 60_000;
const feedCache = new Map<
  string,
  { feed: OpdsFeed; ts: number }
>();

function getBaseUrl(): string {
  const url = process.env.OPDS_URL?.trim();
  if (!url) {
    throw new Error(
      "OPDS_URL не задан. Укажите базовый URL OPDS-сервера в переменных окружения."
    );
  }
  return url.replace(/\/$/, "");
}

function buildOpdsUrl(pathOrQuery: string): string {
  const base = getBaseUrl();
  const path = pathOrQuery.startsWith("http")
    ? pathOrQuery
    : pathOrQuery.startsWith("/")
      ? `${base}${pathOrQuery}`
      : `${base}/opds${pathOrQuery ? `/${pathOrQuery}` : ""}`;
  return path;
}

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseLink(raw: Record<string, unknown>): OpdsLink {
  const href = (raw.href as string) ?? (raw["@_href"] as string) ?? "";
  const rel = (raw.rel as string) ?? (raw["@_rel"] as string) ?? "";
  const type = (raw.type as string) ?? (raw["@_type"] as string);
  const title = (raw.title as string) ?? (raw["@_title"] as string);
  return { rel, href, ...(type && { type }), ...(title && { title }) };
}

function parseAuthor(raw: Record<string, unknown>): OpdsAuthor {
  const name = (raw.name as string) ?? "";
  const uri = (raw.uri as string) ?? (raw["@_uri"] as string);
  return { name, ...(uri && { uri }) };
}

function parseCategory(raw: Record<string, unknown>): { term: string; label?: string } {
  const term = (raw["@_term"] as string) ?? (raw.term as string) ?? "";
  const label = (raw["@_label"] as string) ?? (raw.label as string);
  return { term, ...(label && { label }) };
}

function parseEntry(raw: Record<string, unknown>): OpdsEntry {
  const id = (raw.id as string) ?? "";
  const title = (raw.title as string) ?? "";
  const authors = ensureArray(raw.author ?? []).map((a) =>
    parseAuthor(typeof a === "object" && a !== null ? (a as Record<string, unknown>) : { name: String(a) })
  );
  const categories = ensureArray(raw.category ?? []).map((c) =>
    parseCategory(typeof c === "object" && c !== null ? (c as Record<string, unknown>) : { term: String(c) })
  );
  const language = (raw.language as string) ?? (raw["dc:language"] as string);
  const contentObj = raw.content ?? raw["dc:description"];
  const content =
    typeof contentObj === "string"
      ? contentObj
      : contentObj && typeof contentObj === "object" && "#text" in contentObj
        ? String((contentObj as { "#text"?: string })["#text"] ?? "")
        : "";
  const summaryObj = raw.summary;
  const summary =
    typeof summaryObj === "string"
      ? summaryObj
      : summaryObj && typeof summaryObj === "object" && "#text" in summaryObj
        ? String((summaryObj as { "#text"?: string })["#text"] ?? "")
        : undefined;
  const issued = (raw.issued as string) ?? (raw["dc:issued"] as string);
  const links = ensureArray(raw.link ?? []).map((l) =>
    parseLink(typeof l === "object" && l !== null ? (l as Record<string, unknown>) : { href: "", rel: "" })
  );
  return {
    id,
    title,
    authors,
    categories,
    ...(language && { language }),
    ...(content && { content }),
    ...(summary && { summary }),
    ...(issued && { issued }),
    links,
  };
}

function parseFeed(xml: string): OpdsFeed {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
  });
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const feed = parsed?.feed ?? parsed;
  if (!feed || typeof feed !== "object") {
    throw new Error("Неверный формат OPDS: ожидается элемент feed");
  }
  const f = feed as Record<string, unknown>;
  const title = (f.title as string) ?? "";
  const id = f.id as string | undefined;
  const updated = f.updated as string | undefined;
  const linkList = ensureArray(f.link ?? []);
  const links: OpdsLink[] = linkList.map((l) =>
    parseLink(typeof l === "object" && l !== null ? (l as Record<string, unknown>) : { href: "", rel: "" })
  );
  const entryList = ensureArray(f.entry ?? []);
  const entries: OpdsEntry[] = entryList.map((e) =>
    parseEntry(typeof e === "object" && e !== null ? (e as Record<string, unknown>) : {})
  );
  const totalResults = f.totalResults as number | undefined;
  const itemsPerPage = f.itemsPerPage as number | undefined;
  return {
    title,
    ...(id && { id }),
    ...(updated && { updated }),
    entries,
    links,
    ...(totalResults !== undefined && { totalResults: Number(totalResults) }),
    ...(itemsPerPage !== undefined && { itemsPerPage: Number(itemsPerPage) }),
  };
}

async function fetchFeed(pathOrQuery: string): Promise<OpdsFeed> {
  const url = buildOpdsUrl(pathOrQuery);
  const cached = feedCache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.feed;
  }
  const res = await fetch(url, {
    headers: { Accept: "application/atom+xml, application/xml, text/xml" },
  });
  if (!res.ok) {
    throw new Error(
      `OPDS запрос не удался (${res.status}): ${url} — ${await res.text()}`
    );
  }
  const xml = await res.text();
  const feed = parseFeed(xml);
  feedCache.set(url, { feed, ts: Date.now() });
  return feed;
}

export function getOpdsBaseUrl(): string {
  return getBaseUrl();
}

export async function browseCatalog(path?: string): Promise<OpdsFeed> {
  const pathOrQuery = path ?? "/opds";
  return fetchFeed(pathOrQuery.startsWith("/") ? pathOrQuery : `/opds/${pathOrQuery}`);
}

export async function searchCatalog(
  query: string,
  page = 0
): Promise<OpdsFeed> {
  const encoded = encodeURIComponent(query.trim());
  const path = `/opds/search?q=${encoded}&page=${page}`;
  return fetchFeed(path);
}

export async function getBookDetails(bookId: string): Promise<OpdsEntry | null> {
  const idNorm = bookId.startsWith("book:") ? bookId : `book:${bookId}`;
  const feed = await browseCatalog("/opds");
  const entry = feed.entries.find((e) => e.id === idNorm || e.id === bookId);
  if (entry) return entry;
  const searchFeed = await searchCatalog(bookId.replace(/^book:/, ""), 0);
  const found = searchFeed.entries.find((e) => e.id === idNorm || e.id === bookId);
  return found ?? null;
}

export function formatOpdsEntry(entry: OpdsEntry, baseUrl?: string): string {
  const parts: string[] = [];
  parts.push(`"${entry.title}"`);
  if (entry.authors.length) {
    parts.push(` — ${entry.authors.map((a) => a.name).join(", ")}`);
  }
  if (entry.language) parts.push(`Язык: ${entry.language}`);
  if (entry.categories.length) {
    parts.push(`Жанры/категории: ${entry.categories.map((c) => c.label ?? c.term).join(", ")}`);
  }
  if (entry.issued) parts.push(`Год: ${entry.issued}`);
  if (entry.content) {
    const short =
      entry.content.length > 200 ? entry.content.slice(0, 200) + "..." : entry.content;
    parts.push(`Описание: ${short}`);
  }
  const acquisitionLinks = entry.links.filter(
    (l) => l.rel && l.rel.includes("acquisition")
  );
  if (acquisitionLinks.length) {
    const urls = acquisitionLinks.map((l) => {
      const href = l.href.startsWith("http") ? l.href : `${baseUrl ?? getBaseUrl()}${l.href.startsWith("/") ? "" : "/"}${l.href}`;
      return `${l.type ?? "файл"}: ${href}`;
    });
    parts.push(`Скачать: ${urls.join(" | ")}`);
  }
  parts.push(`ID: ${entry.id}`);
  return parts.join("\n");
}
