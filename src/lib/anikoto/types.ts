// ─── Shared ──────────────────────────────────────────────────────────────────

export interface EpisodeStatus {
  sub?: number | null;
  dub?: number | null;
  total?: number | null;
}

export interface AnimeCard {
  id: string;
  slug: string;
  title: string;
  titleJp?: string;
  image: string;
  href: string;
  type?: string;
  episodes?: EpisodeStatus;
  date?: string;
  score?: number;
  totalEpisodes?: number;
}

// ─── Home ────────────────────────────────────────────────────────────────────

export interface SpotlightAnime {
  slug: string;
  title: string;
  titleJp?: string;
  rating?: string;
  quality?: string;
  hasDub?: boolean;
  hasSub?: boolean;
  date?: string;
  synopsis?: string;
  watchUrl: string;
  href: string;
  image: string;
}

export interface LatestEpisodeItem {
  id: string;
  slug: string;
  title: string;
  titleJp?: string;
  image: string;
  href: string;
  watchHref: string;
  type?: string;
  episodes: EpisodeStatus;
}

export interface TopTableItem {
  id: string;
  slug: string;
  title: string;
  titleJp?: string;
  image: string;
  href: string;
  type?: string;
  episodes: EpisodeStatus;
  date?: string;
}

export interface TopAnimeItem {
  rank: number;
  id: string;
  slug: string;
  title: string;
  titleJp?: string;
  image: string;
  href: string;
  type?: string;
  episodes: EpisodeStatus;
}

export interface HomeData {
  spotlight: SpotlightAnime[];
  latestEpisodes: LatestEpisodeItem[];
  newRelease: TopTableItem[];
  newAdded: TopTableItem[];
  justCompleted: TopTableItem[];
  topDay: TopAnimeItem[];
  topWeek: TopAnimeItem[];
  topMonth: TopAnimeItem[];
}

// ─── Anime Detail ────────────────────────────────────────────────────────────

export interface AnimeDetail {
  id: string;
  slug: string;
  title: string;
  titleJp?: string;
  alternativeTitles: string[];
  image: string;
  rating?: string;
  quality?: string;
  hasDub?: boolean;
  hasSub?: boolean;
  synopsis?: string;
  type?: string;
  premiered?: string;
  aired?: string;
  status?: string;
  genres: string[];
  malScore?: number;
  duration?: string;
  episodeCount?: number;
  studios: string[];
  producers: string[];
  watchUrl: string;
  episodes: AnimeEpisodes;
}

// ─── Episode List ────────────────────────────────────────────────────────────

export interface Episode {
  number: string;
  title?: string;
  href: string;
  id?: string;
  dataIds?: string;
  hasDub?: boolean;
  hasSub?: boolean;
}

export interface AnimeEpisodes {
  animeId: string;
  slug: string;
  episodes: Episode[];
}

// ─── Search / Filter ─────────────────────────────────────────────────────────

export interface SearchResult {
  results: AnimeCard[];
  keyword: string;
  totalResults?: number;
}

export interface FilterParams {
  keyword?: string;
  genre?: string[];
  season?: string[];
  year?: string[];
  type?: string[];
  status?: string[];
  language?: string[];
  rating?: string[];
  sort?: string;
  page?: string;
}

export interface FilterOptions {
  genres: { id: string; name: string; slug: string }[];
  years: string[];
  types: string[];
  seasons: string[];
  statuses: string[];
  languages: string[];
  ratings: string[];
  sorts: string[];
}

export interface FilterResult {
  results: AnimeCard[];
  currentPage: number;
  hasNextPage: boolean;
  params: FilterParams;
  options?: FilterOptions;
}

// ─── Schedule ────────────────────────────────────────────────────────────────

export interface ScheduleDay {
  day: string;
  animes: AnimeCard[];
}

// ─── Watch / Stream ──────────────────────────────────────────────────────────

export interface SubtitleTrack {
  file: string;
  label?: string;
  kind?: string;
  default?: boolean;
  proxyUrl?: string;
}

export interface VideoServer {
  id: string;
  name: string;
  type: string;
}

export interface VideoSource {
  server: string;
  type: string;
  url: string;
  m3u8?: string | null;
  referer?: string;
  proxyUrl?: string | null;
  tracks?: SubtitleTrack[];
}

export interface WatchData {
  episode: Episode;
  servers: VideoServer[];
  sources: VideoSource[];
}
