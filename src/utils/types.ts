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

export const IAnimeSeasonsArr = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const;

export const JSortArr = ['airing', 'bypopularity', 'upcoming', 'favorite', 'rating'] as const;

export const allowedAnimeProviders = ['anikoto', , 'anizone', , 'anidb', 'anibd', 'animeheaven', 'kitsu'];

export const allowedMangaProviders = ['comix', 'allmanga'];

export const JikanList = ['favorite', 'popular', 'rating', 'airing', 'upcoming'] as const;
export type AllAnimeServers = 'mp4upload' | 'internal-s-mp4' | 'internal-default-hls' | 'internal-yt-mp4';
