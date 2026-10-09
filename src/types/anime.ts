import type { IBase, IBaseEpisodes, IBaseMediaInfo, IBasePaginated, IResponse, IServers } from './base.js';

export interface IBaseAnime extends IBase {
  romaji: string | null;
  type?: string | null;
  [x: string]: any;
}

export interface IBaseAnimeInfo extends IBaseMediaInfo {
  romaji: string | null;
  type: string | null;
  episodes?: {
    sub: number | null;
    dub: number | null;
  };
  altTiles?: string[] | [] | null;
  [x: string]: any;
}
export interface IBaseAnimeEpisodes extends IBaseEpisodes {
  hasSub: boolean;
  hasDub: boolean;
  hasRaw?: boolean | unknown;
  [x: string]: any;
}

export interface IAnimeServers extends IServers {
  mediaId: number | string | null;
  eid?: string | null;
}

export interface IAnimeServerInfo {
  sub: IAnimeServers[];
  dub: IAnimeServers[];
  raw: IAnimeServers[];
  episodeNumber: number | null;
}

export type ISubOrDub = 'sub' | 'dub' | 'raw';

export interface IAnimeInfoResponse<T> extends IResponse<T> {
  providerEpisodes: IBaseEpisodes[] | [];
}

export interface IBaseAnimePaginated<T> extends IBasePaginated<T> {
  hasNextPage: boolean;
  currentPage: number;
  [x: string]: any;
}
export interface IBaseAnimeHomeResponse<T> extends IResponse<T> {
  [x: string]: any;
}
export type IBaseAnimeResponse<T> = IResponse<T> & {
  [key: string]: any;
};
export interface IBaseAnimeServerResponse<T> extends IResponse<T> {
  [x: string]: any;
}
export type AnikotoServers = 'vidstream-2' | 'vidcloud-1' | 'vidplay-1' | 'hd-1' | 'hd-2';

export const IGenres = {
  action: 'action',
  adventure: 'adventure',
  cars: 'cars',
  comedy: 'comedy',
  dementia: 'dementia',
  demons: 'demons',
  drama: 'drama',
  ecchi: 'ecchi',
  fantasy: 'fantasy',
  game: 'game',
  harem: 'harem',
  historical: 'historical',
  horror: 'horror',
  isekai: 'isekai',
  josei: 'josei',
  kids: 'kids',
  magic: 'magic',
  'martial-arts': 'martial-arts',
  mecha: 'mecha',
  military: 'military',
  music: 'music',
  mystery: 'mystery',
  parody: 'parody',
  police: 'police',
  psychological: 'psychological',
  romance: 'romance',
  samurai: 'samurai',
  school: 'school',
  'sci-fi': 'sci-fi',
  seinen: 'seinen',
  shoujo: 'shoujo',
  'shoujo-ai': 'shoujo-ai',
  shounen: 'shounen',
  'shounen-ai': 'shounen-ai',
  'slice-of-life': 'slice-of-life',
  space: 'space',
  sports: 'sports',
  'super-power': 'super-power',
  supernatural: 'supernatural',
  thriller: 'thriller',
  vampire: 'vampire',
} as const;

export type IGenre = keyof typeof IGenres;

export interface ScheduleDay {
  day: string;
  date: string;
  timestamp: number | null;
  anime: IBase[];
}
