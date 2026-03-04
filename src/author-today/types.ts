export interface LoginResult {
  token: string;
  issued: string;
  expires: string;
  twoFactorEnabled: boolean;
}

export type LibraryState = "Reading" | "Saved" | "Finished" | "Disliked";

export interface WorkMetaInfo {
  id: number;
  title: string;
  coverUrl: string;
  lastModificationTime: string;
  lastUpdateTime: string;
  finishTime: string | null;
  isFinished: boolean;
  textLength: number;
  textLengthLastRead: number;
  price: number;
  discount: number | null;
  workForm: string;
  status: string;
  authorId: number;
  authorFIO: string;
  authorUserName: string;
  originalAuthor: string | null;
  translator: string | null;
  reciter: string | null;
  coAuthorId: number | null;
  coAuthorFIO: string | null;
  coAuthorUserName: string | null;
  isPurchased: boolean;
  lastReadTime: string | null;
  lastChapterId: number | null;
  lastChapterProgress: number;
  likeCount: number;
  commentCount: number;
  rewardCount: number;
  rewardsEnabled: boolean;
  inLibraryState: LibraryState;
  addedToLibraryTime: string;
  updateInLibraryTime: string;
  adultOnly: boolean;
  seriesId: number | null;
  seriesOrder: number;
  seriesTitle: string | null;
  seriesNextWorkId: number | null;
  genreId: number;
  firstSubGenreId: number | null;
  secondSubGenreId: number | null;
  format: string;
  marks: number[];
}

export interface UserLibraryInfo {
  worksInLibrary: WorkMetaInfo[];
  readingCount: number;
  savedCount: number;
  finishedCount: number;
  purchasedCount: number;
  totalCount: number;
}

export interface CatalogSearchResult {
  searchResults: CatalogWork[];
  totalCount: number;
}

export interface CatalogWork {
  id: number;
  title: string;
  coverUrl: string;
  authorFIO: string;
  authorUserName: string;
  annotation: string;
  genres: string[];
  tags: { id: number; title: string }[];
  finishStatus: string;
  status: string;
  likeCount: number;
  commentCount: number;
  rewardCount: number;
  rating: number;
  textLength: number;
  isFinished: boolean;
  seriesTitle: string | null;
  seriesId: number | null;
  workForm: string;
  price: number;
  discount: number | null;
}
