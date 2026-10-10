export interface ICineMetaSearch {
  id: string | null;
  name: string | null;
  imdbId: string | null;
  posterImage: string | null;
  coverImage: string | null;
  type: string | null;
  startYear: string | null;
  endYear: string | null;
}

export interface ICinemetaEpisode {
  id: string;
  title: string;
  airDate: string;
  seasonNumber: number | null;
  seasonEpisodeNumber: number | null;
  thumbnail: string;
  summary: string;
  type: string;
  [x: string]: any;
}
