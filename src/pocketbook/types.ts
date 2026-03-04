export interface PbProvider {
  alias: string;
  name: string;
  shop_id: string;
  icon?: string;
  icon_eink?: string;
  logged_by?: string;
}

export interface PbToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

export interface PbBookCover {
  width: number;
  height: number;
  path: string;
}

export interface PbBookMetadata {
  title: string;
  authors: string;
  cover?: PbBookCover[];
  lang?: string;
  publisher?: string;
  updated?: string;
  year?: number;
  isbn?: string;
  book_id?: string[];
  fixed_layout?: boolean;
}

export interface PbBookPosition {
  pointer?: string;
  pointer_pb?: string;
  percent: number;
  page?: string;
  pages_total?: number;
  updated?: string;
  offs?: number;
}

export interface PbBook {
  id: string;
  path: string;
  title: string;
  mime_type?: string;
  created_at?: string;
  purchased?: boolean;
  bytes?: number;
  fast_hash: string;
  favorite?: boolean;
  read_status: string;
  link?: string;
  hasLinks?: boolean;
  format?: string;
  name: string;
  read_percent: number;
  percent?: string;
  isDrm?: boolean;
  isLcp?: boolean;
  isAudioBook?: boolean;
  metadata: PbBookMetadata;
  position: PbBookPosition;
  read_position?: PbBookPosition;
  action?: string;
  action_date?: string;
}

export interface PbBooksResponse {
  total: number;
  items: PbBook[];
}
