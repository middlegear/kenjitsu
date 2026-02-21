export interface FastifyParams {
  id?: string;
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
}

export const IAMetaFormatArr = ['TV', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC', 'MANGA'] as const;

export const IAnimeCategoryArr = ['TV', 'MOVIE', 'SPECIALS', 'OVA', 'ONA'] as const;

export const IAnimeSeasonsArr = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const;

export const allowedProviders = ['hianime', 'animepahe', 'anizone'];
