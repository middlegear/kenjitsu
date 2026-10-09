import type { IBasePaginated, IResponse } from '../base.js';

export interface IMetaAnime {
  id: string | null;
  isAdult: boolean;
  image: string | null;
  color?: string | null;
  bannerImage?: string | null;

  title: {
    romaji: string | null;
    english: string | null;
    native: string | null;
  };

  trailer: string | null;

  format: string | null;
  status: string | null;
  synonyms: string[];

  country?: string | null;
  year?: number | null;
  duration: number | null;
  score: number | null;
  genres: string[];

  episodes: number | null;
  synopsis: string | null;
  season?: string | null;
  releaseDate: string | null;
  endDate: string | null;
  studio?: string | null;
  producers: string[];
  [x: string]: any;
}
export interface IMetaCharacters {
  role: string;
  id: number;
  name: string;
  image: string;
  voiceActors: voiceActors[];
}
type voiceActors = {
  name: string;
  image: string;
  language: string;
};

export interface IAnilistCharacters {
  id: number;
  malId: number;
  title: {
    romaji: string;
    english: string;
    native: string;
  };
  characters: IMetaCharacters[];
}

export interface IRelatedAnimeData {
  id: string | null;
  relationType: string;

  title: {
    romaji: string | null;
    english: string | null;
    native: string | null;
  };

  format: string | null;
  type: string | null;

  score: number | null;
  image: string | null;
  bannerImage: string | null;

  color: string | null;
  synonyms: string[];
  country: string | null;
  year: number | null;

  [x: string]: any;
}

interface NextAiringEpisode {
  episode: number;
  id: number;
  airingAt: number;
  timeUntilAiring: number;
}

interface BaseAnimeSchedule {
  malId: number;
  id: number;
  bannerImage: string;
  image: string;
  title: { romaji: string; english: string | null; native: string | null };
  format: string;
  releaseDate: string;
  endDate: string;
  status: string;
  nextAiringEpisode: NextAiringEpisode | null;
}

export interface MediaSchedule extends BaseAnimeSchedule {
  color: string;
  duration: number | null;
}

export interface AiringSchedule extends BaseAnimeSchedule {
  popularity: number;
  score: number;
  genres: string[];
  episodes: number | null;
  synopsis: string;
  season: string | null;
}

export const Seasons = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const;
export type Seasons = (typeof Seasons)[number];

export type IMetaFormat = 'TV' | 'MOVIE' | 'SPECIAL' | 'OVA' | 'ONA' | 'MUSIC' | 'MANGA';

export interface IMetaAnimePaginated<T> extends IBasePaginated<T> {
  lastPage: number;
  perPage: number;
  // totalResults: number;
}
export interface IMetaProviderEpisodes {
  episodeNumber: number | null;
  rating: number | null;
  aired: boolean | null;
  episodeId: string | null;
  title: string | null;
  overview: string | null;
  thumbnail: string | null;
  provider: string | null;
}
export interface IMetaProviderEpisodesResponse<T> extends IResponse<T> {
  providerEpisodes: IMetaProviderEpisodes[] | [];
  provider?: IProviderId | null;
}
export interface IProviderId {
  id: string | number | null;
  name: string | null;
  native?: string | null;
  romaji: string | null;
  provider: string | null;
  score: number | null;
  source?: string | null;
}
export interface IMetaProviderIdResponse<T> extends IResponse<T> {
  provider: IProviderId | null;
}

export interface IMetaAnimeEpisode {
  airDate: string | null;
  title: string | null;
  thumbnail: string | null;
  isFiller: boolean | null;
  episodeNumber: number | null;
  summary: string | null;
  [x: string]: any;
}
