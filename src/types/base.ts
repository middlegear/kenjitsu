export interface IBase {
  id: string | number | null;
  name: string | null;
  [x: string]: any;
}

export interface IBaseEpisodes {
  episodeId: string | null;
  episodeNumber: number | null;
  title?: string | null;
  [x: string]: any;
}

export interface IBaseMediaInfo extends IBase {
  posterImage?: string | null;
  type: string | null;
  releaseDate: string | number | null;
  synopsis: string | null;
  score?: number | null;
  studios?: string | string[] | null;
  [x: string]: any;
}

export interface IServers {
  serverId: number | string | null;
  serverName: string | null;
  [x: string]: any;
}

export interface IResponse<T> {
  data: T;
  error?: string;
  status?: number;
}

export interface ISubtitles {
  url: string | null;
  lang: string | null;
  default?: boolean | null;
}
interface IOutro {
  start: number | null;
  end: number | null;
}
interface ITracks {
  url: string | null;
  type: string | null;
  quality?: string | null;
}
export interface IVideoSource {
  intro?: IOutro;
  outro?: IOutro;
  subtitles?: ISubtitles[];
  tracks?: ITracks[];
  sources: ISource[];
  download?: string | null;
  posterImage?: string | null;
}
export interface ISource {
  url: string | null;
  isM3u8: boolean | null;
  type: string | null;
  quality?: string | null;
}

export type IAnimeCategory = 'MOVIE' | 'TV' | 'ONA' | 'OVA' | 'SPECIALS';

export interface ISourceBaseResponse<T> extends IResponse<T> {
  headers: {
    Referer: string | null;
  };
}
export interface IBasePaginated<T> extends IResponse<T> {
  hasNextPage: boolean;
  currentPage: number;
}

// server
export interface FastifyParams {
  id?: string;
  chapterId?: string;
  episodeId?: string;
  sort?: string;
  genre?: string;
  country?: string;
  season?: string;
  episode?: number;
  year?: string;
  status?: string;
  category?: string;
  format?: string;
  date?: string;
}

export interface FastifyQuery {
  score?: string;
  q?: string;
  year?: string;
  type?: string;
  page?: number;
  perPage?: number;
  format?: string;
  version?: string;
  server?: string;
  provider?: string;
  timeWindow?: string;
  country?: string;
  genre?: string;
  quality?: string;
  hls?: string;
  timezone?: string;
}

export const IAMetaFormatArr = ['TV', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC', 'MANGA'] as const;

export const IAnimeCategoryArr = ['TV', 'MOVIE', 'SPECIALS', 'OVA', 'ONA'] as const;

export const allowedAnimeProviders = ['anikoto', 'anizone', 'animeheaven', 'kitsu'];
