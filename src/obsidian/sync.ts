import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { getLibrary, getWorkDetails, stripHtml } from "../author-today/api.js";
import {
  getReadingBooks as pbGetReading,
  getFinishedBooks as pbGetFinished,
} from "../pocketbook/api.js";
import { genreSlugToName, genreIdToName } from "../author-today/genres.js";
import { searchBookDescription } from "../web-search.js";
import type { WorkMetaInfo } from "../author-today/types.js";
import type { PbBook } from "../pocketbook/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UnifiedBook {
  title: string;
  originalTitle: string;
  author: string[];
  series: string | null;
  seriesNum: number | null;
  status: "reading" | "read" | "want-to-read" | "abandoned";
  source: "author-today" | "pocketbook";
  sourceId: string;
  sourceUrl: string;
  cover: string;
  coverLocal: string;
  progress: number;
  pages: number;
  annotation: string;
  genre: string;
  genreSlug: string;
  textLength: number;
  likeCount: number;
  addedDate: string;
  finishedDate: string;
  atAuthorUsername: string;
}

interface AuthorMeta {
  canonicalName: string;
  aliases: Set<string>;
  atUsername: string;
  bookCount: number;
}

interface SeriesMeta {
  title: string;
  author: string;
  bookCount: number;
}

interface SyncReport {
  created: string[];
  updated: string[];
  unchanged: string[];
  authorsCreated: string[];
  seriesCreated: string[];
  coversDownloaded: number;
  enriched: number;
  webEnriched: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitle(title: string): string {
  let t = title
    .replace(/\s*\[[^\]]*(?:СИ|CИ|litres|АТ|AT)[^\]]*\]\s*/gi, "")
    .replace(/\s*\((?:СИ|CИ)\)\s*/gi, "")
    .replace(/#(\d)/g, "$1")
    .replace(/\.+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  // Strip surrounding quotes
  t = t.replace(/^"(.+)"$/, "$1");
  t = t.replace(/^«(.+)»$/, "$1");
  return t;
}

function normalizeForDedup(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[?!«»""'']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function authorTokenKey(name: string): string {
  return normalizeForDedup(name).split(/\s+/).sort().join(" ");
}

function dedupKey(title: string, author: string): string {
  return `${normalizeForDedup(cleanTitle(title))}|||${authorTokenKey(author)}`;
}

function extractSubTitles(title: string): string[] {
  const subs: string[] = [];
  const addSub = (s: string) => {
    const t = s.trim();
    if (t.length >= 3 && !subs.includes(t)) subs.push(t);
  };
  const seriesSep = /\.\s+(?:Книга|Том|Часть|Кн\.|Т\.)\s*\d+[\.\s]*/i;
  const seriesParts = title.split(seriesSep);
  if (seriesParts.length > 1) addSub(seriesParts[seriesParts.length - 1]);
  const dashNumSep = /-\d+\.\s+/;
  const dashParts = title.split(dashNumSep);
  if (dashParts.length > 1) addSub(dashParts[dashParts.length - 1]);
  const dotParts = title.split(/\.\s+/);
  if (dotParts.length >= 2) addSub(dotParts[dotParts.length - 1]);
  return subs;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

function isoDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toISOString().split("T")[0];
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Series detection from title
// ---------------------------------------------------------------------------

interface SeriesDetection {
  series: string;
  seriesNum: number;
  cleanTitle: string;
}

function parseRoman(s: string): number | null {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let result = 0;
  for (let i = 0; i < s.length; i++) {
    const val = map[s[i]];
    if (!val) return null;
    const next = i + 1 < s.length ? map[s[i + 1]] : undefined;
    if (next && next > val) {
      result += next - val;
      i++;
    } else {
      result += val;
    }
  }
  return result > 0 ? result : null;
}

function detectSeriesFromTitle(title: string): SeriesDetection | null {
  let m: RegExpMatchArray | null;

  // "(prefix num) title" — e.g. "(мк 01) Первый игрок"
  m = title.match(/^\(([а-яА-Яa-zA-Z]+)\s*(\d+)\s*\)\s*(.+)$/);
  if (m) {
    return {
      series: m[1].toUpperCase(),
      seriesNum: parseInt(m[2]),
      cleanTitle: m[3].trim(),
    };
  }

  // "Series. Книга/Том/Часть/Ч. N" — e.g. "Путь одиночки. Книга 3"
  m = title.match(
    /^(.+?)[.,:\s]+(?:Книга|Том|Часть|Кн\.?|Ч\.)[\s\-–—]+(\d+|[IVXLC]+)/i
  );
  if (m) {
    const num = /^\d+$/.test(m[2]) ? parseInt(m[2]) : parseRoman(m[2]);
    if (num) return { series: m[1].trim(), seriesNum: num, cleanTitle: title };
  }

  // "Series N. Subtitle" — e.g. "Лесовик 9. Абсурд"
  m = title.match(/^(.+?)\s+(\d+)\.\s+.+$/);
  if (m && m[1].length > 2) {
    return { series: m[1].trim(), seriesNum: parseInt(m[2]), cleanTitle: title };
  }

  // "Series-N[. subtitle]" — e.g. "Искажающие Реальность-8"
  m = title.match(/^(.+?)\s*[-–—]\s*(\d+)(?:\.\s+.+)?$/);
  if (m && m[1].length > 2) {
    return { series: m[1].trim(), seriesNum: parseInt(m[2]), cleanTitle: title };
  }

  // "Series N Subtitle" — e.g. "Истребитель 3 Зооморф"
  m = title.match(/^(.+?)\s+(\d+)\s+([А-ЯA-Z].{2,})$/);
  if (m && m[1].length > 2 && parseInt(m[2]) <= 50) {
    return { series: m[1].trim(), seriesNum: parseInt(m[2]), cleanTitle: title };
  }

  // "Series N" at end — e.g. "Идеальный мир для Лекаря 15"
  m = title.match(/^(.+?)\s+(\d+)$/);
  if (m && m[1].length > 3) {
    return { series: m[1].trim(), seriesNum: parseInt(m[2]), cleanTitle: title };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Levenshtein distance for fuzzy author matching
// ---------------------------------------------------------------------------

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let j = 1; j <= n; j++) {
    for (let i = 1; i <= m; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }
  return d[m][n];
}

function tokenSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

// ---------------------------------------------------------------------------
// Author normalization — canonical map from AT, fuzzy matching
// ---------------------------------------------------------------------------

function buildAuthorCanonMap(atBooks: UnifiedBook[]): Map<string, string> {
  const canonMap = new Map<string, string>();
  for (const book of atBooks) {
    for (const author of book.author) {
      const key = authorTokenKey(author);
      const existing = canonMap.get(key);
      if (!existing || author.length > existing.length) {
        canonMap.set(key, author);
      }
    }
  }
  return canonMap;
}

function resolveAuthor(name: string, canonMap: Map<string, string>): string {
  const key = authorTokenKey(name);
  const exact = canonMap.get(key);
  if (exact) return exact;

  const tokens = key.split(" ");

  for (const [existingKey, canonName] of canonMap) {
    const existingTokens = existingKey.split(" ");

    // Subset: PB name is a shorter form of AT name (missing отчество)
    if (
      tokens.length < existingTokens.length &&
      tokens.every((t) => existingTokens.includes(t))
    ) {
      canonMap.set(key, canonName);
      return canonName;
    }

    // Superset: PB has more detail (e.g. with отчество), prefer longer form
    if (
      tokens.length > existingTokens.length &&
      existingTokens.every((t) => tokens.includes(t))
    ) {
      canonMap.set(existingKey, name);
      canonMap.set(key, name);
      return name;
    }

    // Fuzzy: same number of tokens, all similar (handles typos)
    if (tokens.length === existingTokens.length && tokens.length > 0) {
      const sorted1 = [...tokens].sort();
      const sorted2 = [...existingTokens].sort();
      let allSimilar = true;
      for (let i = 0; i < sorted1.length; i++) {
        if (tokenSimilarity(sorted1[i], sorted2[i]) < 0.8) {
          allSimilar = false;
          break;
        }
      }
      if (allSimilar) {
        canonMap.set(key, canonName);
        return canonName;
      }
    }
  }

  canonMap.set(key, name);
  return name;
}

/**
 * Split PB author strings that contain multiple authors without separators,
 * e.g. "Олег Сапфир Ковтунов Алексей" → ["Олег Сапфир", "Алексей Ковтунов"]
 */
function splitAndNormalizeAuthors(
  authors: string[],
  canonMap: Map<string, string>
): string[] {
  const result: string[] = [];

  for (const author of authors) {
    const words = author.split(/\s+/);
    if (words.length >= 4) {
      let wasSplit = false;
      for (let i = 2; i <= words.length - 2; i++) {
        const name1 = words.slice(0, i).join(" ");
        const name2 = words.slice(i).join(" ");
        const key1 = authorTokenKey(name1);
        const key2 = authorTokenKey(name2);
        if (canonMap.has(key1) || canonMap.has(key2)) {
          result.push(resolveAuthor(name1, canonMap));
          result.push(resolveAuthor(name2, canonMap));
          wasSplit = true;
          break;
        }
      }
      if (!wasSplit) {
        result.push(resolveAuthor(author, canonMap));
      }
    } else {
      result.push(resolveAuthor(author, canonMap));
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Mapping from source types to UnifiedBook
// ---------------------------------------------------------------------------

function mapAtWork(w: WorkMetaInfo): UnifiedBook {
  const authors: string[] = [w.authorFIO || w.authorUserName];
  if (w.coAuthorFIO) authors.push(w.coAuthorFIO);

  const statusMap: Record<string, "reading" | "read"> = {
    Reading: "reading",
    Finished: "read",
  };

  const cleaned = cleanTitle(w.title);

  return {
    title: cleaned,
    originalTitle: w.title,
    author: authors.filter(Boolean),
    series: w.seriesTitle ? cleanTitle(w.seriesTitle) : null,
    seriesNum: w.seriesOrder > 0 ? w.seriesOrder : null,
    status: statusMap[w.inLibraryState] ?? "reading",
    source: "author-today",
    sourceId: String(w.id),
    sourceUrl: `https://author.today/work/${w.id}`,
    cover: w.coverUrl ?? "",
    coverLocal: "",
    progress: Math.min(Math.round(w.lastChapterProgress), 100),
    pages: 0,
    annotation: "",
    genre: genreIdToName(w.genreId) ?? "",
    genreSlug: "",
    textLength: w.textLength ?? 0,
    likeCount: w.likeCount ?? 0,
    addedDate: isoDate(w.addedToLibraryTime),
    finishedDate:
      w.inLibraryState === "Finished"
        ? isoDate(w.lastReadTime) || ""
        : "",
    atAuthorUsername: w.authorUserName ?? "",
  };
}

function mapPbBook(b: PbBook): UnifiedBook {
  const rawTitle = b.metadata?.title || b.title || b.name;
  const cleaned = cleanTitle(rawTitle);

  const authorsRaw = b.metadata?.authors ?? "";
  const authors = authorsRaw
    .split(/[,;]/)
    .map((a) => a.trim())
    .filter(Boolean);

  const percent = b.read_percent ?? (b.position?.percent ?? 0);
  const isFinished =
    b.read_status === "finished" ||
    b.read_status === "read" ||
    b.read_status === "completed" ||
    percent >= 100;

  const detected = detectSeriesFromTitle(cleaned);

  return {
    title: detected ? detected.cleanTitle : cleaned,
    originalTitle: rawTitle,
    author: authors.length > 0 ? authors : ["Неизвестный автор"],
    series: detected?.series ?? null,
    seriesNum: detected?.seriesNum ?? null,
    status: isFinished ? "read" : "reading",
    source: "pocketbook",
    sourceId: b.id,
    sourceUrl: "",
    cover:
      b.metadata?.cover && b.metadata.cover.length > 0
        ? b.metadata.cover[0].path
        : "",
    coverLocal: "",
    progress: Math.min(Math.round(percent), 100),
    pages: b.position?.pages_total ?? 0,
    annotation: "",
    genre: "",
    genreSlug: "",
    textLength: 0,
    likeCount: 0,
    addedDate: isoDate(b.created_at),
    finishedDate: isFinished ? isoDate(b.action_date) || "" : "",
    atAuthorUsername: "",
  };
}

// ---------------------------------------------------------------------------
// Deduplication: merge AT + PB with author normalization
// ---------------------------------------------------------------------------

function mergeBooks(
  atBooks: UnifiedBook[],
  pbBooks: UnifiedBook[]
): UnifiedBook[] {
  const canonMap = buildAuthorCanonMap(atBooks);

  // Normalize PB authors first (may update canonMap with longer forms)
  for (const book of pbBooks) {
    book.author = splitAndNormalizeAuthors(book.author, canonMap);
  }

  // Re-normalize AT authors using the updated map (handles PB longer forms)
  for (const book of atBooks) {
    book.author = book.author.map((a) => resolveAuthor(a, canonMap));
  }

  const merged = new Map<string, UnifiedBook>();

  for (const book of atBooks) {
    const key = dedupKey(book.title, book.author[0] ?? "");
    merged.set(key, book);
  }

  for (const book of pbBooks) {
    const key = dedupKey(book.title, book.author[0] ?? "");
    const existing = merged.get(key);
    if (existing) {
      existing.progress = book.progress;
      if (book.pages > 0) existing.pages = book.pages;
      if (book.status === "read") existing.status = "read";
    } else {
      merged.set(key, book);
    }
  }

  return [...merged.values()];
}

// ---------------------------------------------------------------------------
// Series name reconciliation: map PB-detected series to AT canonical names
// ---------------------------------------------------------------------------

function roughStem(word: string): string {
  if (word.length <= 3) return word;
  return word.slice(0, -1);
}

function seriesNamesRelated(a: string, b: string): boolean {
  const aWords = normalizeForDedup(a)
    .split(/\s+/)
    .map(roughStem)
    .filter((w) => w.length > 2);
  const bWords = normalizeForDedup(b)
    .split(/\s+/)
    .map(roughStem)
    .filter((w) => w.length > 2);
  if (aWords.length === 0 || bWords.length === 0) return false;

  const shorter = aWords.length <= bWords.length ? aWords : bWords;
  const longer = aWords.length > bWords.length ? aWords : bWords;

  return shorter.every((sw) => longer.some((lw) => lw === sw));
}

function reconcileSeriesNames(books: UnifiedBook[]): void {
  const atSeriesNames = new Set<string>();
  for (const book of books) {
    if (book.source === "author-today" && book.series) {
      atSeriesNames.add(book.series);
    }
  }

  for (const book of books) {
    if (!book.series || atSeriesNames.has(book.series)) continue;

    for (const atName of atSeriesNames) {
      if (seriesNamesRelated(book.series, atName)) {
        book.series = atName;
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Post-processing: assign undetected books to known series
// ---------------------------------------------------------------------------

function assignOrphanBooksToSeries(books: UnifiedBook[]): void {
  const seriesNames = new Set(
    books.filter((b) => b.series).map((b) => b.series!)
  );
  const sortedNames = [...seriesNames].sort((a, b) => b.length - a.length);

  for (const book of books) {
    if (book.series) continue;

    for (const seriesName of sortedNames) {
      if (seriesName.length < 3) continue;
      const titleN = normalizeForDedup(book.title);
      const seriesN = normalizeForDedup(seriesName);

      if (titleN === seriesN) {
        book.series = seriesName;
        if (!book.seriesNum) book.seriesNum = 1;
        break;
      }
      if (
        titleN.startsWith(seriesN + ".") ||
        titleN.startsWith(seriesN + " ")
      ) {
        book.series = seriesName;
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Frontmatter parsing / updating
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): {
  yaml: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { yaml: {}, body: content };

  const yamlBlock = match[1];
  const body = match[2];
  const yaml: Record<string, unknown> = {};

  for (const line of yamlBlock.split("\n")) {
    const kv = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (kv) {
      const [, key, rawVal] = kv;
      const val = rawVal.trim();
      if (val === "" || val === "null") {
        yaml[key] = null;
      } else if (val === "true") {
        yaml[key] = true;
      } else if (val === "false") {
        yaml[key] = false;
      } else if (/^\d+$/.test(val)) {
        yaml[key] = Number(val);
      } else if (val.startsWith("[") && val.endsWith("]")) {
        try {
          yaml[key] = JSON.parse(val);
        } catch {
          yaml[key] = val;
        }
      } else if (val.startsWith('"') && val.endsWith('"')) {
        yaml[key] = val.slice(1, -1);
      } else {
        yaml[key] = val;
      }
    }
  }

  return { yaml, body };
}

function formatYamlValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[${value.map((v) => `"${String(v)}"`).join(", ")}]`;
  }
  const s = String(value);
  if (
    s.includes(":") ||
    s.includes("#") ||
    s.includes('"') ||
    s.includes("[") ||
    s.startsWith("'") ||
    s.startsWith("{")
  ) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

function statusDisplay(status: string): string {
  if (status === "reading") return "Читаю";
  if (status === "read") return "Прочитано";
  if (status === "want-to-read") return "Хочу прочитать";
  return status;
}

function generateBookMarkdown(book: UnifiedBook): string {
  const authorLinks = book.author.map((a) => `"[[${a}]]"`);
  const seriesLink = book.series ? `"[[${book.series}]]"` : "";

  const authorDisplay = book.author.map((a) => `[[${a}]]`).join(", ");
  const seriesDisplay = book.series
    ? `[[${book.series}]]${book.seriesNum ? ` (#${book.seriesNum})` : ""}`
    : "—";
  const sourceDisplay =
    book.source === "author-today"
      ? "Author.Today"
      : book.source === "pocketbook"
        ? "PocketBook Cloud"
        : book.source;

  const coverRef = book.coverLocal || book.cover;
  let coverLine = "";
  if (coverRef) {
    coverLine = book.coverLocal
      ? `\n> ![[${book.coverLocal}|150]]`
      : `\n> ![cover|150](${coverRef})`;
  }

  const dateStart = book.addedDate || (book.status === "reading" ? todayIso() : "");
  const dateEnd = book.status === "read" ? (book.finishedDate || todayIso()) : "";

  const textLenDisplay = book.textLength
    ? `${Math.round(book.textLength / 1000)}к зн.`
    : "—";

  const lines = [
    "---",
    `created: ${book.addedDate || todayIso()}`,
    "type: book",
    `title: ${formatYamlValue(book.title)}`,
    `author: [${authorLinks.join(", ")}]`,
    `series: ${seriesLink}`,
    `series_num: ${book.seriesNum ?? ""}`,
    `genre: ${formatYamlValue(book.genre)}`,
    `status: ${book.status}`,
    `source: ${book.source}`,
    `source_id: ${formatYamlValue(book.sourceId)}`,
    `source_url: ${formatYamlValue(book.sourceUrl)}`,
    `cover: ${formatYamlValue(book.coverLocal || book.cover)}`,
    `progress: ${book.progress}`,
    `pages: ${book.pages}`,
    `text_length: ${book.textLength}`,
    `date_start: ${dateStart}`,
    `date_end: ${dateEnd}`,
    "rating: ",
    `like_count: ${book.likeCount}`,
    "tags: []",
    "aliases: []",
    "---",
    "",
    `# ${book.title}`,
    "",
    `> [!info] Карточка${coverLine}`,
    `> **Автор:** ${authorDisplay}`,
    `> **Серия:** ${seriesDisplay}`,
    `> **Жанр:** ${book.genre || "—"}`,
    `> **Статус:** ${statusDisplay(book.status)} (${book.progress}%)`,
    `> **Источник:** ${sourceDisplay}${book.sourceUrl ? ` — [ссылка](${book.sourceUrl})` : ""}`,
    `> **Объём:** ${textLenDisplay}`,
    `> **Страниц:** ${book.pages || "—"}`,
    "",
    "## Описание",
    "",
    book.annotation || "",
    "",
    "## Мои заметки",
    "",
    "",
    "",
    "---",
    "- [[Library/Index|← Библиотека]]",
    "- [[README|← Главная]]",
    "",
  ];
  return lines.join("\n");
}

function generateAuthorMarkdown(name: string, meta: AuthorMeta): string {
  const profileUrl = meta.atUsername
    ? `https://author.today/u/${meta.atUsername}`
    : "";
  const aliases = [...meta.aliases].filter((a) => a !== name);

  const lines = [
    "---",
    `created: ${todayIso()}`,
    "type: author",
    `name: ${formatYamlValue(name)}`,
    `source_url: ${formatYamlValue(profileUrl)}`,
    "tags: []",
    `aliases: ${aliases.length > 0 ? `[${aliases.map((a) => `"${a}"`).join(", ")}]` : "[]"}`,
    "---",
    "",
    `# ${name}`,
    "",
    "> [!info] Об авторе",
    `> **Профиль:** ${profileUrl ? `[Author.Today](${profileUrl})` : "—"}`,
    '> **Книг в библиотеке:** `= length(filter(pages("Library/Books"), (b) => contains(b.author, this.file.link)))`',
    '> **Прочитано:** `= length(filter(pages("Library/Books"), (b) => contains(b.author, this.file.link) and b.status = "read"))`',
    "",
    "## Книги",
    "",
    "```dataview",
    'TABLE title AS "Книга", series AS "Серия", genre AS "Жанр", status AS "Статус", rating AS "Оценка", date_end AS "Дата"',
    'FROM "Library/Books"',
    "WHERE contains(author, this.file.link)",
    "SORT series ASC, series_num ASC",
    "```",
    "",
    "## Заметки",
    "",
    "",
    "",
    "---",
    "- [[Library/Index|← Библиотека]]",
    "- [[README|← Главная]]",
    "",
  ];
  return lines.join("\n");
}

function generateSeriesMarkdown(title: string, meta: SeriesMeta): string {
  const lines = [
    "---",
    `created: ${todayIso()}`,
    "type: series",
    `title: ${formatYamlValue(title)}`,
    "tags: []",
    "aliases: []",
    "---",
    "",
    `# ${title}`,
    "",
    "> [!info] О серии",
    `> **Автор:** [[${meta.author}]]`,
    `> **Книг в библиотеке:** ${meta.bookCount}`,
    "",
    "## Книги серии",
    "",
    "```dataview",
    'TABLE series_num AS "#", title AS "Книга", status AS "Статус", progress AS "Прогресс"',
    'FROM "Library/Books"',
    "WHERE contains(series, this.file.link)",
    "SORT series_num ASC",
    "```",
    "",
    "---",
    "- [[Library/Index|← Библиотека]]",
    "- [[README|← Главная]]",
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Frontmatter update (preserves body and manual fields)
// ---------------------------------------------------------------------------

function updateBookFrontmatter(
  existingContent: string,
  book: UnifiedBook
): { content: string; changed: boolean } {
  const { yaml, body } = parseFrontmatter(existingContent);

  let changed = false;
  const isAbandoned = yaml.status === "abandoned";
  const updates: Record<string, unknown> = {};
  if (!isAbandoned) {
    updates.status = book.status;
    updates.progress = book.progress;
  }

  if (book.pages > 0) updates.pages = book.pages;
  if (book.status === "read" && !yaml.date_end && book.finishedDate) {
    updates.date_end = book.finishedDate;
  }

  // Enrich previously empty fields from AT data
  if (book.series && !yaml.series) {
    updates.series = `"[[${book.series}]]"`;
  }
  if (book.seriesNum && !yaml.series_num) {
    updates.series_num = book.seriesNum;
  }
  if (book.sourceUrl && !yaml.source_url) {
    updates.source_url = book.sourceUrl;
  }
  if (book.coverLocal && yaml.cover !== book.coverLocal) {
    updates.cover = book.coverLocal;
  }
  if (book.genre && !yaml.genre) {
    updates.genre = book.genre;
  }
  if (book.textLength > 0 && !yaml.text_length) {
    updates.text_length = book.textLength;
  }
  if (book.likeCount > 0 && !yaml.like_count) {
    updates.like_count = book.likeCount;
  }
  for (const [key, newVal] of Object.entries(updates)) {
    if (yaml[key] !== newVal) {
      yaml[key] = newVal;
      changed = true;
    }
  }

  // Also detect body-level staleness
  const bodyNeedsGenreUpdate = !!yaml.genre && /\*\*Жанр:\*\*\s*—/.test(body);
  const descSection = body.split("## Описание")[1] ?? "";
  const descContent = descSection.split(/\n##\s/)[0].trim();
  const bodyNeedsAnnotation = !!book.annotation && descContent.length < 10 && !descContent.startsWith("##");

  if (!changed && !bodyNeedsGenreUpdate && !bodyNeedsAnnotation) {
    return { content: existingContent, changed: false };
  }

  const yamlLines: string[] = [];
  const fieldOrder = [
    "created", "type", "title", "author", "series", "series_num",
    "genre", "status", "source", "source_id", "source_url", "cover",
    "progress", "pages", "text_length", "date_start", "date_end", "rating",
    "like_count", "tags", "aliases",
  ];

  for (const key of fieldOrder) {
    if (key in yaml) {
      yamlLines.push(`${key}: ${formatYamlValue(yaml[key])}`);
    }
  }
  for (const key of Object.keys(yaml)) {
    if (!fieldOrder.includes(key)) {
      yamlLines.push(`${key}: ${formatYamlValue(yaml[key])}`);
    }
  }

  let updatedBody = body;

  // Update genre in body if available
  if (yaml.genre) {
    updatedBody = updatedBody.replace(
      /\*\*Жанр:\*\*\s*—/,
      `**Жанр:** ${yaml.genre}`
    );
  }

  // Insert annotation into body if missing
  if (book.annotation && updatedBody.includes("## Описание")) {
    const descSection = updatedBody.split("## Описание")[1] ?? "";
    const descContent = descSection.split(/\n##\s/)[0].trim();
    if (descContent.length < 10 && !descContent.startsWith("##")) {
      const nextSec = descSection.indexOf("\n## ");
      if (nextSec !== -1) {
        const before = updatedBody.substring(0, updatedBody.indexOf("## Описание") + "## Описание".length);
        const after = descSection.substring(nextSec);
        updatedBody = before + "\n\n" + book.annotation + "\n" + after;
      } else {
        updatedBody = updatedBody.replace(
          /## Описание\s*$/m,
          `## Описание\n\n${book.annotation}\n`
        );
      }
    }
  }

  const newContent = `---\n${yamlLines.join("\n")}\n---\n${updatedBody}`;
  return { content: newContent, changed: true };
}

// ---------------------------------------------------------------------------
// Cover download
// ---------------------------------------------------------------------------

async function downloadCover(
  url: string,
  destPath: string
): Promise<boolean> {
  if (!url) return false;
  try {
    if (await fileExists(destPath)) return true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return false;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 100) return false;
      await writeFile(destPath, buffer);
      return true;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Metadata collection
// ---------------------------------------------------------------------------

function collectAuthorMeta(
  books: UnifiedBook[],
  canonMap: Map<string, string>
): Map<string, AuthorMeta> {
  const authors = new Map<string, AuthorMeta>();

  for (const book of books) {
    for (const authorName of book.author) {
      const key = authorTokenKey(authorName);
      let meta = authors.get(key);
      if (!meta) {
        meta = {
          canonicalName: authorName,
          aliases: new Set<string>(),
          atUsername: "",
          bookCount: 0,
        };
        authors.set(key, meta);
      }

      meta.bookCount++;

      if (authorName !== meta.canonicalName) {
        meta.aliases.add(authorName);
      }
      meta.aliases.add(meta.canonicalName);

      if (book.atAuthorUsername && !meta.atUsername) {
        meta.atUsername = book.atAuthorUsername;
      }
    }
  }

  // Collect all known name forms as aliases
  for (const [key, canonical] of canonMap) {
    const meta = authors.get(key);
    if (meta && canonical !== meta.canonicalName) {
      meta.aliases.add(canonical);
    }
  }

  return authors;
}

function collectSeriesMeta(books: UnifiedBook[]): Map<string, SeriesMeta> {
  const series = new Map<string, SeriesMeta>();

  for (const book of books) {
    if (!book.series) continue;
    const key = normalizeForDedup(book.series);
    let meta = series.get(key);
    if (!meta) {
      meta = {
        title: book.series,
        author: book.author[0] ?? "Неизвестный автор",
        bookCount: 0,
      };
      series.set(key, meta);
    }
    meta.bookCount++;
  }

  return series;
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

export async function syncLibraryToObsidian(
  vaultPath: string,
  dryRun = false
): Promise<SyncReport> {
  const booksDir = join(vaultPath, "Library", "Books");
  const seriesDir = join(vaultPath, "Library", "Series");
  const authorsDir = join(vaultPath, "Meta", "Authors");
  const coversDir = join(vaultPath, "Meta", "Covers");

  if (!dryRun) {
    await ensureDir(booksDir);
    await ensureDir(seriesDir);
    await ensureDir(authorsDir);
    await ensureDir(coversDir);
  }

  const report: SyncReport = {
    created: [],
    updated: [],
    unchanged: [],
    authorsCreated: [],
    seriesCreated: [],
    coversDownloaded: 0,
    enriched: 0,
    webEnriched: 0,
    errors: [],
  };

  // ---- Pre-scan existing files to prevent duplicates ----

  const { readdir } = await import("node:fs/promises");
  const existingBookFiles = new Set<string>();
  const sourceIdIndex = new Map<string, string>();
  const bookDedupIndex = new Map<string, string>();

  try {
    const files = (await readdir(booksDir)).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      existingBookFiles.add(file);
      const content = await readFile(join(booksDir, file), "utf-8");
      const { yaml } = parseFrontmatter(content);
      if (yaml.source_id) sourceIdIndex.set(String(yaml.source_id), file);
      const title = String(yaml.title ?? "");
      const rawAuthor = yaml.author;
      const author = Array.isArray(rawAuthor)
        ? String(rawAuthor[0] ?? "").replace(/^\[\[|\]\]$/g, "")
        : String(rawAuthor ?? "").replace(/^\[\[|\]\]$/g, "");
      if (title) {
        bookDedupIndex.set(dedupKey(title, author), file);
        for (const sub of extractSubTitles(title)) {
          const subKey = dedupKey(sub, author);
          if (!bookDedupIndex.has(subKey)) bookDedupIndex.set(subKey, file);
        }
      }
    }
    console.error(`Pre-scan: ${files.length} existing book files indexed`);
  } catch {
    // Directory might not exist yet on first run
  }

  const existingAuthorKeys = new Map<string, string>();
  try {
    const authorFiles = (await readdir(authorsDir)).filter((f) => f.endsWith(".md"));
    for (const file of authorFiles) {
      const name = file.replace(/\.md$/, "");
      existingAuthorKeys.set(authorTokenKey(name), file);
    }
  } catch {
    // Directory might not exist yet
  }

  function findExistingBookFile(book: UnifiedBook, filename: string): string | null {
    if (existingBookFiles.has(filename)) return filename;
    const byId = sourceIdIndex.get(book.sourceId);
    if (byId) return byId;
    const author = book.author[0] ?? "";
    const byKey = bookDedupIndex.get(dedupKey(book.title, author));
    if (byKey) return byKey;
    for (const sub of extractSubTitles(book.title)) {
      const bySub = bookDedupIndex.get(dedupKey(sub, author));
      if (bySub) return bySub;
    }
    return null;
  }

  // ---- Fetch books from both sources ----

  const atBooks: UnifiedBook[] = [];
  const pbBooks: UnifiedBook[] = [];

  try {
    // Sequential calls to avoid race condition on library cache
    const atReading = await getLibrary("Reading");
    const atFinished = await getLibrary("Finished");
    atBooks.push(
      ...atReading.works.map(mapAtWork),
      ...atFinished.works.map(mapAtWork)
    );
    console.error(`AT: fetched ${atBooks.length} books (reading: ${atReading.totalCount}, finished: ${atFinished.totalCount})`);
  } catch (err) {
    const msg = `AT fetch error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(msg);
    report.errors.push(msg);
  }

  try {
    const [pbReading, pbFinished] = await Promise.all([
      pbGetReading(),
      pbGetFinished(),
    ]);
    pbBooks.push(
      ...pbReading.books.map(mapPbBook),
      ...pbFinished.books.map(mapPbBook)
    );
    console.error(`PB: fetched ${pbBooks.length} books`);
  } catch (err) {
    const msg = `PB fetch error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(msg);
    report.errors.push(msg);
  }

  // ---- Merge and post-process ----

  const books = mergeBooks(atBooks, pbBooks);
  reconcileSeriesNames(books);
  assignOrphanBooksToSeries(books);

  for (const book of books) {
    if (book.status === "reading" && book.progress >= 95) {
      book.status = "read";
      if (!book.finishedDate) book.finishedDate = todayIso();
    }
  }

  console.error(`Merged: ${books.length} unique books`);

  // ---- Enrich new AT books (annotation + genre) ----
  // Only for books that don't already have a card on disk

  if (!dryRun) {
    const newAtBooks = [];
    for (const book of books) {
      if (book.source !== "author-today") continue;
      const mainAuthor = book.author[0] ?? "Неизвестный автор";
      const filename = sanitizeFilename(`${mainAuthor} — ${book.title}`) + ".md";
      if (!findExistingBookFile(book, filename)) {
        newAtBooks.push(book);
      }
    }

    if (newAtBooks.length > 0) {
      console.error(`Enriching ${newAtBooks.length} new AT books (annotation + genre)...`);
      const ENRICH_BATCH = 15;
      let enriched = 0;
      for (let i = 0; i < newAtBooks.length; i += ENRICH_BATCH) {
        const batch = newAtBooks.slice(i, i + ENRICH_BATCH);
        await Promise.all(
          batch.map(async (book) => {
            const details = await getWorkDetails(Number(book.sourceId));
            if (!details) return;
            if (details.annotation) book.annotation = details.annotation;
            if (!book.genre && details.genreId) {
              const name = genreIdToName(details.genreId);
              if (name) book.genre = name;
            }
            enriched++;
          })
        );
        if (i + ENRICH_BATCH < newAtBooks.length) {
          await new Promise((r) => setTimeout(r, 3500));
        }
      }
      console.error(`Enriched ${enriched}/${newAtBooks.length} books`);
    }

    // ---- Web search fallback for books without annotation ----

    const booksNeedingDesc: UnifiedBook[] = [];
    for (const book of books) {
      if (book.annotation) continue;
      const mainAuthor = book.author[0] ?? "Неизвестный автор";
      const filename = sanitizeFilename(`${mainAuthor} — ${book.title}`) + ".md";
      if (!findExistingBookFile(book, filename)) {
        booksNeedingDesc.push(book);
      }
    }

    if (booksNeedingDesc.length > 0) {
      console.error(`Web search fallback for ${booksNeedingDesc.length} books without annotation...`);
      const WEB_BATCH = 5;
      for (let i = 0; i < booksNeedingDesc.length; i += WEB_BATCH) {
        const batch = booksNeedingDesc.slice(i, i + WEB_BATCH);
        await Promise.all(
          batch.map(async (book) => {
            const desc = await searchBookDescription(book.title, book.author[0] ?? "");
            if (desc) {
              book.annotation = desc;
              report.webEnriched++;
            }
          })
        );
        if (i + WEB_BATCH < booksNeedingDesc.length) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      console.error(`Web enriched: ${report.webEnriched}/${booksNeedingDesc.length}`);
    }
  }

  // ---- Download covers ----

  if (!dryRun) {
    const COVER_CONCURRENCY = 5;
    for (let i = 0; i < books.length; i += COVER_CONCURRENCY) {
      const batch = books.slice(i, i + COVER_CONCURRENCY);
      await Promise.all(
        batch.map(async (book) => {
          if (!book.cover) return;
          const ext = book.cover.match(/\.(png|webp|gif)/i) ? book.cover.match(/\.(png|webp|gif)/i)![0] : ".jpg";
          const coverFilename =
            sanitizeFilename(`${book.author[0] ?? "Unknown"} — ${book.title}`) + ext;
          const coverPath = join(coversDir, coverFilename);
          if (await downloadCover(book.cover, coverPath)) {
            book.coverLocal = `Meta/Covers/${coverFilename}`;
            report.coversDownloaded++;
          }
        })
      );
    }
    console.error(`Covers downloaded: ${report.coversDownloaded}`);
  }

  // ---- Write book files ----

  for (const book of books) {
    const mainAuthor = book.author[0] ?? "Неизвестный автор";
    const filename =
      sanitizeFilename(`${mainAuthor} — ${book.title}`) + ".md";

    const existingFile = findExistingBookFile(book, filename);

    if (existingFile) {
      const existingPath = join(booksDir, existingFile);
      const existing = await readFile(existingPath, "utf-8");
      const { content, changed } = updateBookFrontmatter(existing, book);
      if (changed) {
        if (!dryRun) await writeFile(existingPath, content, "utf-8");
        report.updated.push(existingFile);
      } else {
        report.unchanged.push(existingFile);
      }
    } else {
      const filePath = join(booksDir, filename);
      if (!dryRun) {
        await writeFile(filePath, generateBookMarkdown(book), "utf-8");
        existingBookFiles.add(filename);
        sourceIdIndex.set(book.sourceId, filename);
        bookDedupIndex.set(dedupKey(book.title, book.author[0] ?? ""), filename);
      }
      report.created.push(filename);
    }
  }

  // ---- Collect metadata ----

  const canonMap = buildAuthorCanonMap(books);
  const authorsMeta = collectAuthorMeta(books, canonMap);
  const seriesMeta = collectSeriesMeta(books);

  // ---- Write author pages (with dedup via pre-scan index) ----

  const writtenAuthorKeys = new Set<string>();

  for (const [key, meta] of authorsMeta) {
    if (writtenAuthorKeys.has(key)) continue;
    writtenAuthorKeys.add(key);

    const authorFilename = sanitizeFilename(meta.canonicalName) + ".md";
    const authorFile = join(authorsDir, authorFilename);
    const existingByKey = existingAuthorKeys.has(key);
    const existsByName = await fileExists(authorFile);

    if (!existingByKey && !existsByName) {
      if (!dryRun) {
        await writeFile(
          authorFile,
          generateAuthorMarkdown(meta.canonicalName, meta),
          "utf-8"
        );
        existingAuthorKeys.set(key, authorFilename);
      }
      report.authorsCreated.push(meta.canonicalName);
    }
  }

  // ---- Write series pages ----

  for (const [, meta] of seriesMeta) {
    const seriesFile = join(seriesDir, sanitizeFilename(meta.title) + ".md");
    if (!(await fileExists(seriesFile))) {
      if (!dryRun) {
        await writeFile(
          seriesFile,
          generateSeriesMarkdown(meta.title, meta),
          "utf-8"
        );
      }
      report.seriesCreated.push(meta.title);
    }
  }

  return report;
}

export function formatSyncReport(report: SyncReport): string {
  const lines: string[] = ["Синхронизация завершена:"];
  lines.push(`  Создано книг: ${report.created.length}`);
  lines.push(`  Обновлено: ${report.updated.length}`);
  lines.push(`  Без изменений: ${report.unchanged.length}`);
  lines.push(`  Авторов создано: ${report.authorsCreated.length}`);
  lines.push(`  Серий создано: ${report.seriesCreated.length}`);
  lines.push(`  Обложек скачано: ${report.coversDownloaded}`);
  if (report.enriched > 0) {
    lines.push(`  Обогащено (аннотация/жанр): ${report.enriched}`);
  }
  if (report.webEnriched > 0) {
    lines.push(`  Обогащено (веб-поиск): ${report.webEnriched}`);
  }

  if (report.errors.length > 0) {
    lines.push("", "Ошибки:");
    report.errors.forEach((e) => lines.push(`  ! ${e}`));
  }
  if (report.created.length > 0) {
    lines.push("", "Новые книги:");
    report.created.forEach((f) => lines.push(`  + ${f}`));
  }
  if (report.updated.length > 0) {
    lines.push("", "Обновлены:");
    report.updated.forEach((f) => lines.push(`  ~ ${f}`));
  }
  if (report.authorsCreated.length > 0) {
    lines.push("", "Новые авторы:");
    report.authorsCreated.forEach((a) => lines.push(`  + ${a}`));
  }
  if (report.seriesCreated.length > 0) {
    lines.push("", "Новые серии:");
    report.seriesCreated.forEach((s) => lines.push(`  + ${s}`));
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Enrich existing books (batch annotation + genre fetch)
// ---------------------------------------------------------------------------

export interface EnrichReport {
  enriched: number;
  webEnriched: number;
  skipped: number;
  errors: string[];
}

interface EnrichItem {
  file: string;
  content: string;
  source: string;
  sourceId: number;
  title: string;
  author: string;
  needsAnnotation: boolean;
  needsGenre: boolean;
}

export async function enrichExistingBooks(
  vaultPath: string,
  batchSize = 50
): Promise<EnrichReport> {
  const booksDir = join(vaultPath, "Library", "Books");
  const report: EnrichReport = { enriched: 0, webEnriched: 0, skipped: 0, errors: [] };

  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(booksDir)).filter((f) => f.endsWith(".md"));

  const toEnrich: EnrichItem[] = [];

  for (const file of files) {
    const filePath = join(booksDir, file);
    const content = await readFile(filePath, "utf-8");
    const { yaml, body } = parseFrontmatter(content);

    const descSection = body.split("## Описание")[1] ?? "";
    const descContent = descSection.split(/\n##\s/)[0].trim();
    const hasAnnotation = descContent.length > 10 && !descContent.startsWith("##");
    const hasGenre = !!yaml.genre;

    if (hasAnnotation && hasGenre) { report.skipped++; continue; }

    const source = String(yaml.source ?? "");
    const sourceId = Number(yaml.source_id) || 0;

    if (source === "author-today" && !sourceId) { report.skipped++; continue; }
    if (source !== "author-today" && hasAnnotation) { report.skipped++; continue; }

    const title = String(yaml.title ?? "");
    const rawAuthor = yaml.author;
    const author = Array.isArray(rawAuthor)
      ? String(rawAuthor[0] ?? "").replace(/^\[\[|\]\]$/g, "")
      : String(rawAuthor ?? "").replace(/^\[\[|\]\]$/g, "");

    if (!title) { report.skipped++; continue; }

    toEnrich.push({
      file, content, source, sourceId, title, author,
      needsAnnotation: !hasAnnotation,
      needsGenre: !hasGenre,
    });
    if (toEnrich.length >= batchSize) break;
  }

  console.error(`Enrich: ${toEnrich.length} books to process (batch limit: ${batchSize})`);

  const BATCH = 3;
  for (let i = 0; i < toEnrich.length; i += BATCH) {
    const batch = toEnrich.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (item) => {
        try {
          const { yaml, body } = parseFrontmatter(item.content);
          let annotation = "";
          let genreId = 0;
          let changed = false;
          let fromWeb = false;

          if (item.source === "author-today" && item.sourceId) {
            const details = await getWorkDetails(item.sourceId);
            if (details) {
              annotation = details.annotation ?? "";
              genreId = details.genreId ?? 0;
            }
          }

          if (!annotation && item.needsAnnotation) {
            annotation = await searchBookDescription(item.title, item.author);
            if (annotation) fromWeb = true;
          }

          if (annotation && item.needsAnnotation) {
            const descHeader = "## Описание";
            const idx = body.indexOf(descHeader);
            if (idx !== -1) {
              const afterDesc = body.substring(idx + descHeader.length);
              const nextSection = afterDesc.indexOf("\n## ");
              const existingDesc = nextSection !== -1
                ? afterDesc.substring(0, nextSection).trim()
                : afterDesc.trim();

              if (existingDesc.length < 10) {
                const newBody = nextSection !== -1
                  ? body.substring(0, idx) + descHeader + "\n\n" + annotation + "\n" + afterDesc.substring(nextSection)
                  : body.substring(0, idx) + descHeader + "\n\n" + annotation + "\n";
                item.content = `---\n${rebuildYaml(yaml)}\n---\n${newBody}`;
                changed = true;
              }
            }
          }

          if (item.needsGenre && genreId) {
            const genreName = genreIdToName(genreId);
            if (genreName) {
              yaml.genre = genreName;
              changed = true;
            }
          }

          if (changed) {
            let { body: latestBody } = parseFrontmatter(item.content);
            if (yaml.genre) {
              latestBody = latestBody.replace(
                /\*\*Жанр:\*\*\s*—/,
                `**Жанр:** ${yaml.genre}`
              );
            }
            item.content = `---\n${rebuildYaml(yaml)}\n---\n${latestBody}`;
            await writeFile(join(booksDir, item.file), item.content, "utf-8");
            if (fromWeb) {
              report.webEnriched++;
            } else {
              report.enriched++;
            }
          } else {
            report.skipped++;
          }
        } catch (err) {
          report.errors.push(`${item.file}: ${err instanceof Error ? err.message : String(err)}`);
        }
      })
    );
    if (i + BATCH < toEnrich.length) {
      await new Promise((r) => setTimeout(r, 3500));
    }
  }

  return report;
}

function rebuildYaml(yaml: Record<string, unknown>): string {
  const fieldOrder = [
    "created", "type", "title", "author", "series", "series_num",
    "genre", "status", "source", "source_id", "source_url", "cover",
    "progress", "pages", "text_length", "date_start", "date_end", "rating",
    "like_count", "tags", "aliases",
  ];
  const lines: string[] = [];
  for (const key of fieldOrder) {
    if (key in yaml) {
      lines.push(`${key}: ${formatYamlValue(yaml[key])}`);
    }
  }
  for (const key of Object.keys(yaml)) {
    if (!fieldOrder.includes(key)) {
      lines.push(`${key}: ${formatYamlValue(yaml[key])}`);
    }
  }
  return lines.join("\n");
}

export function formatEnrichReport(report: EnrichReport): string {
  const lines = [
    "Обогащение карточек завершено:",
    `  Обогащено (AT API): ${report.enriched}`,
    `  Обогащено (веб-поиск): ${report.webEnriched}`,
    `  Пропущено: ${report.skipped}`,
  ];
  if (report.errors.length > 0) {
    lines.push("", "Ошибки:");
    report.errors.forEach((e) => lines.push(`  ! ${e}`));
  }
  return lines.join("\n");
}
