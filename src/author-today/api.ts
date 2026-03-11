import { getToken, clearToken, refreshToken, fetchWithRetry } from "./auth.js";
import type {
  WorkMetaInfo,
  UserLibraryInfo,
  LibraryState,
  CatalogWork,
} from "./types.js";

const API_BASE = "https://api.author.today/v1";

async function authedFetch(url: string, retry = true): Promise<Response> {
  const token = await getToken();
  const res = await fetchWithRetry(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (res.status === 401 && retry) {
    const body = await res.json().catch(() => ({}));
    const code = body?.code;

    if (code === "ExpiredToken") {
      await refreshToken();
    } else {
      clearToken();
    }

    return authedFetch(url, false);
  }

  return res;
}

// --- Library ---

let libraryCache: { works: WorkMetaInfo[]; ts: number } | null = null;
let libraryFetchInFlight: Promise<WorkMetaInfo[]> | null = null;
const CACHE_TTL_MS = 60_000;

const PAGE_SIZE = 500;

async function fetchFullLibrary(): Promise<WorkMetaInfo[]> {
  if (libraryCache && Date.now() - libraryCache.ts < CACHE_TTL_MS) {
    return libraryCache.works;
  }
  if (libraryFetchInFlight) return libraryFetchInFlight;
  libraryFetchInFlight = fetchFullLibraryInner().finally(() => { libraryFetchInFlight = null; });
  return libraryFetchInFlight;
}

async function fetchFullLibraryInner(): Promise<WorkMetaInfo[]> {

  const allWorks: WorkMetaInfo[] = [];
  let page = 1;
  let totalCount = Infinity;

  while (allWorks.length < totalCount) {
    const res = await authedFetch(
      `${API_BASE}/account/user-library?pageSize=${PAGE_SIZE}&page=${page}`
    );
    if (!res.ok) {
      throw new Error(
        `Library fetch failed (${res.status}): ${await res.text()}`
      );
    }

    const data: UserLibraryInfo = await res.json();
    totalCount = data.totalCount ?? 0;
    const works = data.worksInLibrary ?? [];
    if (works.length === 0) break;
    allWorks.push(...works);
    console.error(`AT library page ${page}: got ${works.length} works (total so far: ${allWorks.length}/${totalCount})`);
    page++;
    if (works.length < PAGE_SIZE) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  libraryCache = { works: allWorks, ts: Date.now() };
  return allWorks;
}

export async function getLibrary(
  state: LibraryState
): Promise<{ works: WorkMetaInfo[]; totalCount: number }> {
  const all = await fetchFullLibrary();
  const filtered = all.filter((w) => w.inLibraryState === state);
  return { works: filtered, totalCount: filtered.length };
}

// --- Catalog search ---

export async function searchCatalog(
  genre: string = "all",
  sorting: string = "popular",
  page = 1
): Promise<{ works: CatalogWork[]; totalCount: number }> {
  const params = new URLSearchParams({
    genre,
    sorting,
    page: String(page),
    ps: "20",
  });

  const res = await authedFetch(`${API_BASE}/catalog/search?${params}`);
  if (!res.ok) {
    throw new Error(`Catalog search failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const works: CatalogWork[] = (data.searchResults ?? []).map(mapCatalogWork);
  return { works, totalCount: data.totalCount ?? works.length };
}

function mapCatalogWork(raw: Record<string, unknown>): CatalogWork {
  return {
    id: (raw.id as number) ?? 0,
    title: (raw.title as string) ?? "",
    coverUrl: (raw.coverUrl as string) ?? "",
    authorFIO: (raw.authorFIO as string) ?? "",
    authorUserName: (raw.authorUserName as string) ?? "",
    annotation: stripHtml((raw.annotation as string) ?? ""),
    genres: Array.isArray(raw.genres) ? raw.genres : [],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    finishStatus: (raw.finishStatus as string) ?? "",
    status: (raw.status as string) ?? "",
    likeCount: (raw.likeCount as number) ?? 0,
    commentCount: (raw.commentCount as number) ?? 0,
    rewardCount: (raw.rewardCount as number) ?? 0,
    rating: (raw.rating as number) ?? 0,
    textLength: (raw.textLength as number) ?? 0,
    isFinished: (raw.isFinished as boolean) ?? false,
    seriesTitle: (raw.seriesTitle as string) ?? null,
    seriesId: (raw.seriesId as number) ?? null,
    workForm: (raw.workForm as string) ?? "",
    price: (raw.price as number) ?? 0,
    discount: (raw.discount as number) ?? null,
  };
}

// --- Work details (annotation) ---

export interface WorkDetails {
  id: number;
  title: string;
  annotation: string;
  authorNotes: string;
  genreId: number;
  firstSubGenreId: number | null;
  secondSubGenreId: number | null;
  genre: string;
  firstSubGenre: string;
  secondSubGenre: string;
  tags: { id: number; title: string }[];
}

export async function getWorkDetails(workId: number): Promise<WorkDetails | null> {
  try {
    const res = await authedFetch(`${API_BASE}/work/${workId}/details`);
    if (!res.ok) {
      console.error(`getWorkDetails(${workId})/details: HTTP ${res.status}`);
      return null;
    }
    const details = await res.json();

    const metaRes = await authedFetch(`${API_BASE}/work/${workId}/meta-info`);
    const meta = metaRes.ok ? await metaRes.json() : {};

    return {
      id: meta.id ?? workId,
      title: meta.title ?? "",
      annotation: stripHtml(details.annotation ?? ""),
      authorNotes: stripHtml(details.authorNotes ?? ""),
      genreId: meta.genreId ?? 0,
      firstSubGenreId: meta.firstSubGenreId ?? null,
      secondSubGenreId: meta.secondSubGenreId ?? null,
      genre: "",
      firstSubGenre: "",
      secondSubGenre: "",
      tags: Array.isArray(details.tags) ? details.tags : [],
    };
  } catch (err) {
    console.error(`getWorkDetails(${workId}) error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// --- Formatting ---

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&[^;]+;/g, " ")
    .trim();
}

export function formatLibraryWork(w: WorkMetaInfo): string {
  const parts = [
    `"${w.title}" — ${w.authorFIO || w.authorUserName}`,
  ];
  if (w.seriesTitle) parts.push(`Серия: ${w.seriesTitle}`);
  parts.push(`Статус: ${w.isFinished ? "Завершена" : "В процессе"}`);
  parts.push(`Объём: ${w.textLength} зн.`);
  if (w.lastChapterProgress > 0) {
    parts.push(`Прогресс: ${Math.min(Math.round(w.lastChapterProgress), 100)}%`);
  }
  parts.push(`Лайков: ${w.likeCount}`);
  if (w.addedToLibraryTime) {
    parts.push(`Добавлено: ${w.addedToLibraryTime.split("T")[0]}`);
  }
  parts.push(`URL: https://author.today/work/${w.id}`);
  return parts.join("\n");
}

export function formatCatalogWork(w: CatalogWork): string {
  const parts = [
    `"${w.title}" — ${w.authorFIO || w.authorUserName}`,
  ];
  if (w.seriesTitle) parts.push(`Серия: ${w.seriesTitle}`);
  if (w.genres.length) parts.push(`Жанры: ${w.genres.join(", ")}`);
  if (w.rating) parts.push(`Рейтинг: ${w.rating}`);
  if (w.textLength) parts.push(`Объём: ${w.textLength} зн.`);
  parts.push(`Статус: ${w.isFinished ? "Завершена" : "В процессе"}`);
  if (w.likeCount) parts.push(`Лайков: ${w.likeCount}`);
  if (w.annotation) {
    const short =
      w.annotation.length > 200
        ? w.annotation.slice(0, 200) + "..."
        : w.annotation;
    parts.push(`Описание: ${short}`);
  }
  parts.push(`URL: https://author.today/work/${w.id}`);
  return parts.join("\n");
}
