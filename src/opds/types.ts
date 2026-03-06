export interface OpdsLink {
  rel: string;
  type?: string;
  href: string;
  title?: string;
}

export interface OpdsAuthor {
  name: string;
  uri?: string;
}

export interface OpdsEntry {
  id: string;
  title: string;
  authors: OpdsAuthor[];
  categories: { term: string; label?: string }[];
  language?: string;
  content?: string;
  summary?: string;
  issued?: string;
  links: OpdsLink[];
}

export interface OpdsFeed {
  title: string;
  id?: string;
  updated?: string;
  entries: OpdsEntry[];
  links: OpdsLink[];
  totalResults?: number;
  itemsPerPage?: number;
}
