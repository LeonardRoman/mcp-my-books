import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { getLibrary } from "../author-today/api.js";
import {
  getReadingBooks as pbGetReading,
  getFinishedBooks as pbGetFinished,
} from "../pocketbook/api.js";
import type { WorkMetaInfo } from "../author-today/types.js";
import type { PbBook } from "../pocketbook/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UnifiedBook {
  title: string;
  author: string[];
  series: string | null;
  seriesNum: number | null;
  status: "reading" | "read";
  source: "author-today" | "pocketbook";
  sourceId: string;
  sourceUrl: string;
  cover: string;
  progress: number;
  pages: number;
}

interface SyncReport {
  created: string[];
  updated: string[];
  unchanged: string[];
  authorsCreated: string[];
  seriesCreated: string[];
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

function normalizeForDedup(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, "е");
}

function dedupKey(title: string, author: string): string {
  return `${normalizeForDedup(title)}|||${normalizeForDedup(author)}`;
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

  return {
    title: w.title,
    author: authors.filter(Boolean),
    series: w.seriesTitle ?? null,
    seriesNum: w.seriesOrder > 0 ? w.seriesOrder : null,
    status: statusMap[w.inLibraryState] ?? "reading",
    source: "author-today",
    sourceId: String(w.id),
    sourceUrl: `https://author.today/work/${w.id}`,
    cover: w.coverUrl ?? "",
    progress: Math.min(Math.round(w.lastChapterProgress), 100),
    pages: 0,
  };
}

function mapPbBook(b: PbBook): UnifiedBook {
  const title = b.metadata?.title || b.title || b.name;
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

  return {
    title,
    author: authors.length > 0 ? authors : ["Неизвестный автор"],
    series: null,
    seriesNum: null,
    status: isFinished ? "read" : "reading",
    source: "pocketbook",
    sourceId: b.id,
    sourceUrl: "",
    cover:
      b.metadata?.cover && b.metadata.cover.length > 0
        ? b.metadata.cover[0].path
        : "",
    progress: Math.min(Math.round(percent), 100),
    pages: b.position?.pages_total ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Deduplication: merge AT + PB
// ---------------------------------------------------------------------------

function mergeBooks(atBooks: UnifiedBook[], pbBooks: UnifiedBook[]): UnifiedBook[] {
  const merged = new Map<string, UnifiedBook>();

  for (const book of atBooks) {
    const key = dedupKey(book.title, book.author[0] ?? "");
    merged.set(key, book);
  }

  for (const book of pbBooks) {
    const key = dedupKey(book.title, book.author[0] ?? "");
    const existing = merged.get(key);
    if (existing) {
      // AT has richer metadata (series, genres, URL), PB has real reading progress
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

function generateBookMarkdown(book: UnifiedBook): string {
  const authorLinks = book.author.map((a) => `"[[${a}]]"`);
  const seriesLink = book.series ? `"[[${book.series}]]"` : "";

  const authorDisplay = book.author.map((a) => `[[${a}]]`).join(", ");
  const seriesDisplay = book.series ? `[[${book.series}]]` : "—";
  const statusDisplay = book.status === "reading" ? "Читаю" : "Прочитано";
  const sourceDisplay =
    book.source === "author-today"
      ? "Author.Today"
      : book.source === "pocketbook"
        ? "PocketBook Cloud"
        : book.source;

  const lines = [
    "---",
    `created: ${todayIso()}`,
    "type: book",
    `title: ${formatYamlValue(book.title)}`,
    `author: [${authorLinks.join(", ")}]`,
    `series: ${seriesLink}`,
    `series_num: ${book.seriesNum ?? ""}`,
    `status: ${book.status}`,
    `source: ${book.source}`,
    `source_id: ${formatYamlValue(book.sourceId)}`,
    `source_url: ${formatYamlValue(book.sourceUrl)}`,
    `cover: ${formatYamlValue(book.cover)}`,
    `progress: ${book.progress}`,
    `pages: ${book.pages}`,
    `date_start: ${book.status === "reading" ? todayIso() : ""}`,
    `date_end: ${book.status === "read" ? todayIso() : ""}`,
    "rating: ",
    "tags: []",
    "aliases: []",
    "---",
    "",
    `# ${book.title}`,
    "",
    "> [!info] Карточка",
    `> **Автор:** ${authorDisplay}`,
    `> **Серия:** ${seriesDisplay}`,
    `> **Статус:** ${statusDisplay}`,
    `> **Источник:** ${sourceDisplay}${book.sourceUrl ? ` — [ссылка](${book.sourceUrl})` : ""}`,
    `> **Страниц:** ${book.pages || "—"}`,
    "",
    "## Описание",
    "",
    "",
    "",
    "## Мои заметки",
    "",
    "",
    "",
    "## Цитаты",
    "",
    "> ",
    "",
    "## Смотри также",
    "- ",
    "",
    "---",
    "- [[Library/Index|← Библиотека]]",
    "- [[README|← Главная]]",
    "",
  ];
  return lines.join("\n");
}

function generateAuthorMarkdown(name: string): string {
  const lines = [
    "---",
    `created: ${todayIso()}`,
    "type: author",
    `name: ${formatYamlValue(name)}`,
    "source_url: ",
    "tags: []",
    "aliases: []",
    "---",
    "",
    `# ${name}`,
    "",
    "> [!info] Об авторе",
    "> **Сайт / профиль:** ",
    "> **Жанры:** ",
    "",
    "## Книги",
    "",
    "```dataview",
    'TABLE title AS "Книга", series AS "Серия", status AS "Статус", rating AS "Оценка"',
    'FROM "Library/Books"',
    "WHERE contains(author, this.file.link)",
    "SORT series_num ASC",
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

function generateSeriesMarkdown(title: string): string {
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
    "> **Автор:** ",
    "> **Жанр:** ",
    "> **Всего книг:** ",
    "",
    "## Описание",
    "",
    "",
    "",
    "## Книги серии",
    "",
    "```dataview",
    'TABLE series_num AS "#", file.link AS "Книга", author AS "Автор", status AS "Статус"',
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
  const updates: Record<string, unknown> = {
    status: book.status,
    progress: book.progress,
  };

  if (book.pages > 0) updates.pages = book.pages;
  if (book.status === "read" && !yaml.date_end) updates.date_end = todayIso();

  for (const [key, newVal] of Object.entries(updates)) {
    if (yaml[key] !== newVal) {
      yaml[key] = newVal;
      changed = true;
    }
  }

  if (!changed) return { content: existingContent, changed: false };

  const yamlLines: string[] = [];
  const fieldOrder = [
    "created", "type", "title", "author", "series", "series_num",
    "status", "source", "source_id", "source_url", "cover",
    "progress", "pages", "date_start", "date_end", "rating",
    "tags", "aliases",
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

  const newContent = `---\n${yamlLines.join("\n")}\n---\n${body}`;
  return { content: newContent, changed: true };
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

  if (!dryRun) {
    await ensureDir(booksDir);
    await ensureDir(seriesDir);
    await ensureDir(authorsDir);
  }

  const report: SyncReport = {
    created: [],
    updated: [],
    unchanged: [],
    authorsCreated: [],
    seriesCreated: [],
  };

  // Fetch books from both sources
  const atBooks: UnifiedBook[] = [];
  const pbBooks: UnifiedBook[] = [];

  try {
    const [atReading, atFinished] = await Promise.all([
      getLibrary("Reading"),
      getLibrary("Finished"),
    ]);
    atBooks.push(
      ...atReading.works.map(mapAtWork),
      ...atFinished.works.map(mapAtWork)
    );
  } catch (err) {
    console.error("AT fetch error:", err);
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
  } catch (err) {
    console.error("PB fetch error:", err);
  }

  const books = mergeBooks(atBooks, pbBooks);

  // Track unique authors and series
  const allAuthors = new Set<string>();
  const allSeries = new Set<string>();

  for (const book of books) {
    const mainAuthor = book.author[0] ?? "Неизвестный автор";
    const filename = sanitizeFilename(`${mainAuthor} — ${book.title}`) + ".md";
    const filePath = join(booksDir, filename);

    book.author.forEach((a) => allAuthors.add(a));
    if (book.series) allSeries.add(book.series);

    if (await fileExists(filePath)) {
      const existing = await readFile(filePath, "utf-8");
      const { content, changed } = updateBookFrontmatter(existing, book);
      if (changed) {
        if (!dryRun) await writeFile(filePath, content, "utf-8");
        report.updated.push(filename);
      } else {
        report.unchanged.push(filename);
      }
    } else {
      if (!dryRun) {
        await writeFile(filePath, generateBookMarkdown(book), "utf-8");
      }
      report.created.push(filename);
    }
  }

  // Create author pages
  for (const author of allAuthors) {
    const authorFile = join(authorsDir, sanitizeFilename(author) + ".md");
    if (!(await fileExists(authorFile))) {
      if (!dryRun) {
        await writeFile(authorFile, generateAuthorMarkdown(author), "utf-8");
      }
      report.authorsCreated.push(author);
    }
  }

  // Create series pages
  for (const series of allSeries) {
    const seriesFile = join(seriesDir, sanitizeFilename(series) + ".md");
    if (!(await fileExists(seriesFile))) {
      if (!dryRun) {
        await writeFile(seriesFile, generateSeriesMarkdown(series), "utf-8");
      }
      report.seriesCreated.push(series);
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
