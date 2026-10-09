import type { IResponse } from '../../types/base.js';
import type {
  IAnimeListItem,
  IMetaMovie,
  IMetaMovieArtworks,
  IMetaMovieEpisodes,
  IMetaMoviePaginated,
  IMovieInfo,
} from '../../types/meta/meta-movie.js';
import { BaseClass, type ClientConfig } from '../models/base.js';

/**
 * A class for interacting with The Movie Database (TMDb) API to search for and retrieve
 * information about TV shows and movies, including trending, popular, top-rated, seasonal data,
 * episode information, and streaming source integration with external providers.
 */
export class TheMovieDatabase extends BaseClass {
  private readonly apiKey: string = 'ea021b3b0775c8531592713ab727f254';

  /** Base URL for the TMDb API */
  private readonly baseUrl: string = 'https://api.themoviedb.org/3';

  /**
   * Creates an instance of the TMDb API client.
   */
  constructor(
    options: ClientConfig = {
      browser: 'okhttp4',
      http3: false,
    },
  ) {
    super(options);
  }

  /**
   * Searches for TV shows based on the provided query string using TMDb API.
   *
   * @param query - The search query string (required)
   * @param page - The page number for pagination (optional, defaults to 1)
   * @param year - The first air date year
   * @returns Promise resolving to paginated list of TV shows matching the search query
   */
  async searchShows(query: string, page: number = 1, year?: number): Promise<IMetaMoviePaginated<IMetaMovie[] | []>> {
    if (!query) {
      return {
        hasNextPage: false,
        currentPage: 0,
        totalResults: 0,
        lastPage: 0,
        data: [],
        error: 'Missing required parameter. Query',
      };
    }

    return this.fetchPaginatedData('/search/tv', {
      include_adult: 'false',
      page: String(page),
      query,
      ...(year !== undefined && { first_air_date_year: String(year) }),
    });
  }
  /**
   * Fetches detailed TV show information from TMDb using append_to_response
   */
  async fetchShowInfo(tmdbId: number): Promise<IResponse<IAnimeListItem | null>> {
    if (!tmdbId) {
      return {
        data: null,
        error: 'Missing required parameter: tmdbId',
        status: 400,
      };
    }

    try {
      const params = new URLSearchParams({
        api_key: this.apiKey,
        append_to_response: 'images',
        include_image_language: 'en,null',
      });

      const finalUrl = `${this.baseUrl}/tv/${tmdbId}?${params.toString()}`;
      const response = await this.client.fetch(finalUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return {
          data: null,
          error: response?.statusText,
          status: response.status,
        };
      }
      const result = await response.json();
      const data: IAnimeListItem = {
        tmdbId: result.id || null,
        name: result.name || null,
        originalName: result.original_name || null,
        posterImage: result.poster_path ? `https://image.tmdb.org/t/p/original${result.poster_path}` : null,
        backdrop: result.backdrop_path ? `https://image.tmdb.org/t/p/w1280${result.backdrop_path}` : null,
        status: result.status || null,
        country: result.origin_country || null,
        language: result.original_language || null,
        episodes: result.number_of_episodes || null,
        totalSeasons: result.number_of_seasons || null,
        rating: result.vote_average || null,
        genres: result.genres || null,
        summary: result.overview || null,
        releaseDate: result.first_air_date || null,
        lastAired: result.last_air_date || null,
        latestEpisode: this.formatEpisode(result.last_episode_to_air),
        nextEpisode: this.formatEpisode(result.next_episode_to_air),
        seasons: (result.seasons || []).map((item: any) => ({
          airDate: item.air_date || null,
          id: item.id || null,
          name: item.name || null,
          rating: item.vote_average || null,
          totalEpisodes: item.episode_count || null,
          summary: item.overview || null,
          seasonNumber: item.season_number,
          posterImage: item.poster_path ? `https://image.tmdb.org/t/p/original${item.poster_path}` : null,
        })),
        artWorks: {
          backdrop: (result.images?.backdrops || [])
            .map((item: any) => (item.file_path ? `https://image.tmdb.org/t/p/w1280${item.file_path}` : null))
            .filter(Boolean)
            .slice(0, 5),

          logos: (result.images?.logos || [])
            .map((item: any) => (item.file_path ? `https://image.tmdb.org/t/p/w780${item.file_path}` : null))
            .filter(Boolean)
            .slice(0, 5),

          posterImages: (result.images?.posters || [])
            .map((item: any) => (item.file_path ? `https://image.tmdb.org/t/p/original${item.file_path}` : null))
            .filter(Boolean)
            .slice(0, 5),
        },
      };

      return { data: data as IAnimeListItem };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        status: 500,
      };
    }
  }

  /**
   * Fetches episodes available in a specific season of a TV show from TMDb.
   *
   * @param tmdbId - The unique TMDb ID for the TV show (required)
   * @param season - The season number for which to fetch episodes (required)
   * @returns Promise resolving to array of episodes with their detailed information for the specified season
   */
  async fetchTvEpisodes(tmdbId: number, season: number): Promise<IResponse<IMetaMovieEpisodes[] | []>> {
    if (!tmdbId) {
      return { error: 'Missing required params: tmdbId!', data: [], status: 400 };
    }

    try {
      const queryString = new URLSearchParams({
        api_key: this.apiKey,
      }).toString();

      const response = await this.client.fetch(`${this.baseUrl}/tv/${tmdbId}/season/${season}?${queryString}`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
      });

      if (!response.ok) return { error: response.statusText, data: [], status: response.status };
      const result = await response.json();
      const episodes: IMetaMovieEpisodes[] = result.episodes.map((item: any) => ({
        airDate: item.air_date || null,
        episodeNumber: item.episode_number || null,
        episodeType: item.episode_type || null,
        tmdbEpisodeId: item.id || null,
        title: item.name || null,
        summary: item.overview || null,
        rating: item.vote_average || null,
        seasonNumber: item.season_number,
        tmdbId: item.show_id || null,
        runtime: item.runtime || null,
        images: item.still_path ? `https://image.tmdb.org/t/p/w1280${item.still_path}` : null,
      }));

      return { data: episodes as IMetaMovieEpisodes[] };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error', data: [], status: 500 };
    }
  }

  /**
   * Fetches detailed information about a specific episode from a TV show.
   *
   * @param tmdbId - The unique TMDb ID for the TV show (required)
   * @param season - The season number containing the episode (optional, defaults to 1)
   * @param episodeNumber - The episode number for which to fetch information (optional, defaults to 1)
   * @returns Promise resolving to detailed episode information including images and ratings
   */
  async fetchEpisodeInfo(
    tmdbId: number,
    season: number,
    episodeNumber: number,
  ): Promise<IResponse<IMetaMovieEpisodes | null>> {
    try {
      const queryString = new URLSearchParams({
        api_key: this.apiKey,
      }).toString();

      const response = await this.client.fetch(
        `${this.baseUrl}/tv/${tmdbId}/season/${season}/episode/${episodeNumber}?${queryString}`,
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
          },
        },
      );

      if (!response.ok) return { error: response.statusText, data: null, status: response.status };

      const result = await response.json();
      const episode = {
        airDate: result.air_date || null,
        title: result.name || null,
        summary: result.overview || null,
        rating: result.vote_average || null,
        seasonNumber: result.season_number || null,
        tmdbEpisodeId: result.id || null,
        runtime: result.runtime || null,
        thumbnail: result.still_path ? `https://image.tmdb.org/t/p/w1280${result.still_path}` : null,
      };

      return {
        data: episode as IMetaMovieEpisodes,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        data: null,
        status: 500,
      };
    }
  }

  /**
   * Fetches trending TV shows based on a specified time window from TMDb.
   *
   * @param timeWindow - The time window to fetch trending shows (day or week) (optional, defaults to 'week')
   * @param page - The page number for pagination (optional, defaults to 1)
   * @returns Promise resolving to paginated list of trending TV shows
   */
  async fetchTrendingTv(
    timeWindow: 'day' | 'week' = 'week',
    page: number = 1,
  ): Promise<IMetaMoviePaginated<IMetaMovie[] | []>> {
    return this.fetchPaginatedData(`/trending/tv/${timeWindow}`, { page: String(page) });
  }

  /**
   * Fetches popular TV shows from TMDb.
   *
   * @param page - The page number for pagination (optional, defaults to 1)
   * @returns Promise resolving to paginated list of popular TV shows
   */
  async fetchPopularTv(page: number = 1): Promise<IMetaMoviePaginated<IMetaMovie[] | []>> {
    return this.fetchPaginatedData('/tv/popular', { page: String(page) });
  }

  /**
   * Fetches top-rated TV shows from TMDb.
   *
   * @param page - The page number for pagination (optional, defaults to 1)
   * @returns Promise resolving to paginated list of top-rated TV shows
   */
  async fetchTopShows(page: number = 1): Promise<IMetaMoviePaginated<IMetaMovie[] | []>> {
    return this.fetchPaginatedData('/tv/top_rated', { page: String(page) });
  }

  /**
   * Searches for movies based on the provided query string using TMDb API.
   *
   * @param query - The search query string (required)
   * @param page - The page number for pagination (optional, defaults to 1)
   * @returns Promise resolving to paginated list of movies matching the search query
   */
  async searchMovie(query: string, page: number = 1, year?: number): Promise<IMetaMoviePaginated<IMetaMovie[] | []>> {
    if (!query) {
      return {
        hasNextPage: false,
        currentPage: 0,
        totalResults: 0,
        lastPage: 0,
        data: [],
        error: 'Missing required parameter. Query',
      };
    }

    return this.fetchPaginatedMovieData('/search/movie', {
      include_adult: 'false',
      page: String(page),
      query,
      ...(year !== undefined && { primary_release_year: String(year) }),
    });
  }

  /**
   * Fetches detailed information about a specific movie using its TMDb ID.
   *
   * @param tmdbId - The unique TMDb ID for the movie (required)
   * @returns Promise resolving to comprehensive movie information
   */
  async fetchMovieInfo(tmdbId: number): Promise<IResponse<IMovieInfo | null>> {
    if (!tmdbId) {
      return {
        data: null,

        error: 'Missing required parameter: tmdbId',
        status: 400,
      };
    }

    try {
      const queryParams = new URLSearchParams({
        api_key: this.apiKey,
        include_image_language: 'en,null',
      }).toString();

      const url = `${this.baseUrl}/movie/${tmdbId}?append_to_response=images&${queryParams}`;

      const response = await this.client.fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return {
          data: null,
          error: response.statusText,
          status: response.status,
        };
      }

      const result = await response.json();
      const data: IMovieInfo = {
        tmdbId: result.id || null,
        name: result.title || null,
        originalName: result.original_title || null,
        posterImage: result.poster_path ? `https://image.tmdb.org/t/p/original${result.poster_path}` : null,
        backdrop: result.backdrop_path ? `https://image.tmdb.org/t/p/w1280${result.backdrop_path}` : null,
        status: result.status || null,
        country: result.origin_country || null,
        language: result.original_language || null,
        rating: result.vote_average || null,
        genres: result.genres || null,
        runtime: result.runtime || null,
        summary: result.overview || null,
        releaseDate: result.release_date || null,
        artWorks: {
          backdrop: (result.images?.backdrops || [])
            .map((item: any) => (item.file_path ? `https://image.tmdb.org/t/p/w1280${item.file_path}` : null))
            .filter(Boolean)
            .slice(0, 5),

          logos: (result.images?.logos || [])
            .map((item: any) => (item.file_path ? `https://image.tmdb.org/t/p/w780${item.file_path}` : null))
            .filter(Boolean)
            .slice(0, 5),

          posterImages: (result.images?.posters || [])
            .map((item: any) => (item.file_path ? `https://image.tmdb.org/t/p/original${item.file_path}` : null))
            .filter(Boolean)
            .slice(0, 5),
        },
      };

      return { data: data };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        status: 500,
      };
    }
  }

  /**
   * Fetches trending movies based on a specified time window from TMDb.
   *
   * @param timeWindow - The time window to fetch trending movies (day or week) (optional, defaults to 'week')
   * @param page - The page number for pagination (optional, defaults to 1)
   * @returns Promise resolving to paginated list of trending movies
   */
  async fetchTrendingMovies(
    timeWindow: 'day' | 'week' = 'week',
    page: number = 1,
  ): Promise<IMetaMoviePaginated<IMetaMovie[] | []>> {
    return this.fetchPaginatedMovieData(`/trending/movie/${timeWindow}`, { page: String(page) });
  }

  /**
   * Fetches popular movies from TMDb.
   *
   * @param page - The page number for pagination (optional, defaults to 1)
   * @returns Promise resolving to paginated list of popular movies
   */
  async fetchPopularMovies(page: number = 1): Promise<IMetaMoviePaginated<IMetaMovie[] | []>> {
    return this.fetchPaginatedMovieData('/movie/popular', { page: String(page) });
  }

  /**
   * Fetches top-rated movies from TMDb.
   *
   * @param page - The page number for pagination (optional, defaults to 1)
   * @returns Promise resolving to paginated list of top-rated movies
   */
  async fetchTopMovies(page: number = 1): Promise<IMetaMoviePaginated<IMetaMovie[] | []>> {
    return this.fetchPaginatedMovieData('/movie/top_rated', { page: String(page) });
  }

  /**
   * Fetches the current season's anime automatically based on today's date.
   * @param env - Cloudflare Environment
   * @param page - Page number (default: 1)
   * @returns Promise with enriched current seasonal anime data
   */
  async fetchSeasonalAnime(page: number = 1): Promise<IMetaMoviePaginated<IMetaMovie[] | []>> {
    try {
      const endpoint = '/discover/tv';

      const { season, year } = this.getCurrentSeasonAndYear();
      const { start, end } = this.getSeasonDates(season, year);

      const params = {
        api_key: this.apiKey,
        with_genres: '16,10759',
        with_original_language: 'ja',
        with_origin_country: 'JP',
        'air_date.gte': start,
        'air_date.lte': end,
        sort_by: 'popularity.desc',
        page: page.toString(),
      };

      const queryString = new URLSearchParams(params).toString();

      const separator = endpoint.includes('?') ? '&' : '?';
      const url = `${this.baseUrl}${endpoint}${separator}${queryString}`;

      const response = await this.client.fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        return {
          hasNextPage: false,
          currentPage: 0,
          totalResults: 0,
          lastPage: 0,
          data: [],
          error: response?.statusText,
          status: response.status,
        };
      }
      const result = await response.json();
      const data: IMetaMovie[] = result.results.map((item: any) => ({
        tmdbId: item.id || null,
        name: item.name || item.title || null,
        originalName: item.original_name || item.original_title || null,
        posterImage: item.poster_path ? `https://image.tmdb.org/t/p/original${item.poster_path}` : null,
        backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
        country: item.origin_country?.[0] || null,
        type: 'tv',
        language: item.original_language || null,
        releaseDate: item.first_air_date || null,
        summary: item.overview || null,
        genres: item.genre_ids || null,
        rating: item.vote_average || null,
      }));

      return {
        hasNextPage: result.page < result.total_pages,
        currentPage: result.page,
        totalResults: result.total_results,
        lastPage: result.total_pages,
        data: data,
      };
    } catch (error) {
      return {
        hasNextPage: false,
        currentPage: 0,
        totalResults: 0,
        lastPage: 0,
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        status: 500,
      };
    }
  }

  /**
   * Fetches popular anime from TMDb
   * @param page - Page number (default: 1)
   * @returns Promise with enriched top anime data
   */
  async fetchPopularAnime(page: number): Promise<IMetaMoviePaginated<IMetaMovie[] | []>> {
    try {
      const endpoint = '/discover/tv';

      const queryString = new URLSearchParams({
        api_key: this.apiKey,
        with_genres: '16,10759',
        with_original_language: 'ja',
        with_origin_country: 'JP',
        sort_by: 'popularity.desc',
        page: String(page),
      }).toString();

      const url = `${this.baseUrl}${endpoint}?${queryString}`;

      const response = await this.client.fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        return {
          hasNextPage: false,
          currentPage: 0,
          totalResults: 0,
          lastPage: 0,
          data: [],
          error: response?.statusText,
          status: response.status,
        };
      }
      const result = await response.json();
      const data: IMetaMovie[] = result.results.map((item: any) => ({
        tmdbId: item.id || null,
        name: item.name || item.title || null,
        originalName: item.original_name || item.original_title || null,
        posterImage: item.poster_path ? `https://image.tmdb.org/t/p/original${item.poster_path}` : null,
        backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
        country: item.origin_country || null,
        type: item.media_type || null,
        language: item.original_language || null,
        releaseDate: item.first_air_date || null,
        summary: item.overview || null,
        genres: item.genre_ids || null,
        rating: item.vote_average || null,
      }));

      return {
        hasNextPage: result.page < result.total_pages,
        currentPage: result.page,
        totalResults: result.total_results,
        lastPage: result.total_pages,
        data: data,
      };
    } catch (error) {
      return {
        hasNextPage: false,
        currentPage: 0,
        totalResults: 0,
        lastPage: 0,
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        status: 500,
      };
    }
  }

  /**
   * Fetches top anime from TMDb and enriches with detailed info
   *

   * @param page - Page number (default: 1)
   * @returns Promise with enriched top anime data
   */
  async fetchTopAnime(page: number): Promise<IMetaMoviePaginated<IMetaMovie[] | []>> {
    try {
      const endpoint = '/discover/tv';

      const params = {
        api_key: this.apiKey,
        with_genres: '16,10759,10765',
        with_original_language: 'ja',
        with_origin_country: 'JP',
        sort_by: 'vote_average.desc',
        'vote_count.gte': `${200}`,
        page: page.toString(),
      };

      const queryString = new URLSearchParams(params).toString();

      const separator = endpoint.includes('?') ? '&' : '?';
      const url = `${this.baseUrl}${endpoint}${separator}${queryString}`;

      const response = await this.client.fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return {
          hasNextPage: false,
          currentPage: 0,
          totalResults: 0,
          lastPage: 0,
          data: [],
          error: response?.statusText,
          status: response.status,
        };
      }
      const result = await response.json();
      const data: IMetaMovie[] = result.results.map((item: any) => ({
        tmdbId: item.id || null,
        name: item.name || item.title || null,
        originalName: item.original_name || item.original_title || null,
        posterImage: item.poster_path ? `https://image.tmdb.org/t/p/original${item.poster_path}` : null,
        backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
        country: item.origin_country || null,
        type: item.media_type || null,
        language: item.original_language || null,
        releaseDate: item.first_air_date || null,
        summary: item.overview || null,
        genres: item.genre_ids || null,
        rating: item.vote_average || null,
      }));

      return {
        hasNextPage: result.page < result.total_pages,
        currentPage: result.page,
        totalResults: result.total_results,
        lastPage: result.total_pages,
        data: data,
      };
    } catch (error) {
      return {
        hasNextPage: false,
        currentPage: 0,
        totalResults: 0,
        lastPage: 0,
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Fetches anime airing within the current week and enriches the data.
   * Useful for "Airing This Week" or "Simulcast" sections.
   * @param page - Page number (default: 1)
   * @returns Promise with enriched weekly anime data
   */
  async fetchWeeklyAnime(page: number = 1): Promise<IMetaMoviePaginated<IMetaMovie[] | []>> {
    try {
      const endpoint = '/discover/tv';
      const { start, end } = this.getWeeklyDates();

      const params = {
        api_key: this.apiKey,
        with_genres: '16,10759',
        with_original_language: 'ja',
        with_origin_country: 'JP',
        'air_date.gte': start,
        'air_date.lte': end,
        sort_by: 'popularity.desc',
        page: page.toString(),
      };

      const queryString = new URLSearchParams(params).toString();

      const url = `${this.baseUrl}${endpoint}${endpoint.includes('?') ? '&' : '?'}${queryString}`;

      const response = await this.client.fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return {
          hasNextPage: false,
          currentPage: 0,
          totalResults: 0,
          lastPage: 0,
          data: [],
          error: response?.statusText,
          status: response.status,
        };
      }

      const result = await response.json();
      const data: IMetaMovie[] = result.results.map((item: any) => ({
        tmdbId: item.id || null,
        name: item.name || item.title || null,
        originalName: item.original_name || item.original_title || null,
        posterImage: item.poster_path ? `https://image.tmdb.org/t/p/original${item.poster_path}` : null,
        backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
        country: item.origin_country?.[0] || null,
        type: 'tv',
        language: item.original_language || null,
        releaseDate: item.first_air_date || null,
        summary: item.overview || null,
        genres: item.genre_ids || null,
        rating: item.vote_average || null,
      }));

      return {
        hasNextPage: result.page < result.total_pages,
        currentPage: result.page,
        totalResults: result.total_results,
        lastPage: result.total_pages,
        data: data,
      };
    } catch (error) {
      return {
        hasNextPage: false,
        currentPage: 0,
        totalResults: 0,
        lastPage: 0,
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Fetches Artworks for shows
   */
  async fetchShowArtWorks(tmdbId: number): Promise<IResponse<IMetaMovieArtworks | null>> {
    if (!tmdbId) {
      return {
        data: null,
        error: 'Missing required parameter: tmdbId',
        status: 400,
      };
    }

    try {
      const queryString = new URLSearchParams({
        api_key: this.apiKey,
      }).toString();

      const response = await this.client.fetch(`${this.baseUrl}/tv/${tmdbId}/images?${queryString}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return {
          data: null,
          error: response?.statusText,
          status: response.status,
        };
      }

      const result = await response.json();
      const data: IMetaMovieArtworks = {
        backdrop: (result.backdrops || []).map((item: any) =>
          item.file_path ? `https://image.tmdb.org/t/p/w1280${item.file_path}` : null,
        ),
        logos: (result.logos || []).map((item: any) =>
          item.file_path ? `https://image.tmdb.org/t/p/w780${item.file_path}` : null,
        ),
        posterImages: (result.posters || []).map((item: any) =>
          item.file_path ? `https://image.tmdb.org/t/p/original${item.file_path}` : null,
        ),
      };

      return { data: data };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        status: 500,
      };
    }
  }

  /**
   * Fetches Artworks for movies
   */
  async fetchMovieArtWorks(tmdbId: number): Promise<IResponse<IMetaMovieArtworks | null>> {
    if (!tmdbId) {
      return {
        data: null,
        error: 'Missing required parameter: tmdbId',
        status: 400,
      };
    }

    try {
      const queryString = new URLSearchParams({
        api_key: this.apiKey,
      }).toString();

      const response = await this.client.fetch(`${this.baseUrl}/movie/${tmdbId}/images?${queryString}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return {
          data: null,
          error: response?.statusText,
          status: response.status,
        };
      }

      const result = await response.json();
      const data: IMetaMovieArtworks = {
        backdrop: (result.backdrops || []).map((item: any) =>
          item.file_path ? `https://image.tmdb.org/t/p/w1280${item.file_path}` : null,
        ),
        logos: (result.logos || []).map((item: any) =>
          item.file_path ? `https://image.tmdb.org/t/p/w780${item.file_path}` : null,
        ),
        posterImages: (result.posters || []).map((item: any) =>
          item.file_path ? `https://image.tmdb.org/t/p/original${item.file_path}` : null,
        ),
      };

      return { data: data };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        status: 500,
      };
    }
  }

  /**
   * Helper to format episode data (latest / next)
   */
  private formatEpisode(episode: any) {
    if (!episode) return null;
    return {
      episodeId: episode.id,
      title: episode.name,
      episodeNumber: episode.episode_number,
      episodeType: episode.episode_type,
      season: episode.season_number,
      summary: episode.overview,
      rating: episode.vote_average,
      airDate: episode.air_date,
    };
  }

  /**
   * Automatically determines the current anime season and year
   */
  private getCurrentSeasonAndYear() {
    const now = new Date();
    const month = now.getMonth() + 1; // JS months are 0-11
    const year = now.getFullYear();

    let season: 'winter' | 'spring' | 'summer' | 'fall';

    if (month >= 1 && month <= 3) season = 'winter';
    else if (month >= 4 && month <= 6) season = 'spring';
    else if (month >= 7 && month <= 9) season = 'summer';
    else season = 'fall';

    return { season, year };
  }

  private getSeasonDates(season: 'winter' | 'spring' | 'summer' | 'fall', year: number) {
    const seasons = {
      winter: { start: `${year}-01-01`, end: `${year}-03-31` },
      spring: { start: `${year}-04-01`, end: `${year}-06-30` },
      summer: { start: `${year}-07-01`, end: `${year}-09-30` },
      fall: { start: `${year}-10-01`, end: `${year}-12-31` },
    };
    return seasons[season.toLowerCase() as keyof typeof seasons];
  }

  /**
   * Calculates a weekly date range with a past offset.
   * @param offsetWeeks - How many weeks to go back (default 1) very useful
   */
  private getWeeklyDates(offsetWeeks: number = 0): { start: string; end: string } {
    const now = new Date();

    // 1. Move the 'now' pointer back by X weeks
    now.setDate(now.getDate() - offsetWeeks * 7);

    const dayOfWeek = now.getDay(); // 0 (Sun) to 6 (Sat)

    // 2. Calculate Monday for that specific past week
    const diffToMonday = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diffToMonday));

    // 3. Calculate Sunday for that same past week
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    return {
      start: monday.toISOString().split('T')[0],
      end: sunday.toISOString().split('T')[0],
    };
  }

  /**
   * Reusable method to fetch paginated TV show data from TMDb API.
   *
   * @private
   * @param endpoint - The API endpoint to fetch data from (e.g., '/search/tv')
   * @param params - Query parameters for the API request
   * @returns Promise resolving to paginated TV show data with metadata
   */
  private async fetchPaginatedData(
    endpoint: string,
    params: Record<string, string>,
  ): Promise<IMetaMoviePaginated<IMetaMovie[] | []>> {
    try {
      const allParams = {
        language: 'en-US',
        api_key: this.apiKey,
        ...params,
      };

      const queryString = new URLSearchParams(allParams).toString();

      const response = await this.client.fetch(`${this.baseUrl}${endpoint}?${queryString}`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
      });

      if (!response.ok) {
        return {
          hasNextPage: false,
          currentPage: 0,
          totalResults: 0,
          lastPage: 0,
          data: [],
          error: response.statusText,
          status: response.status,
        };
      }
      const result = await response.json();

      const pagination = {
        currentPage: result.page,
        hasNextPage: result.total_pages > 1,
        totalPages: result.total_pages,
        totalResults: result.total_results,
      };

      const data = result.results.map((item: any) => ({
        tmdbId: item.id || null,
        name: item.name || item.title || null,
        originalName: item.original_name || item.original_title || null,
        posterImage: item.poster_path ? `https://image.tmdb.org/t/p/original${item.poster_path}` : null,
        backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
        country: item.origin_country || null,
        type: item.media_type || null,
        language: item.original_language || null,
        releaseDate: item.first_air_date || null,
        summary: item.overview || null,
        genres: item.genre_ids || null,
        rating: item.vote_average || null,
      }));

      return {
        hasNextPage: pagination.hasNextPage,
        currentPage: pagination.currentPage,
        totalResults: pagination.totalResults,
        lastPage: pagination.totalPages,
        data: data as IMetaMovie[],
      };
    } catch (error) {
      return {
        hasNextPage: false,
        currentPage: 0,
        totalResults: 0,
        lastPage: 0,
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        status: 500,
      };
    }
  }

  /**
   * Reusable method to fetch paginated movie data from TMDb API.
   *
   * @private
   * @param endpoint - The API endpoint to fetch data from (e.g., '/search/movie')
   * @param params - Query parameters for the API request
   * @returns Promise resolving to paginated movie data with metadata
   */
  private async fetchPaginatedMovieData(
    endpoint: string,
    params: Record<string, string>,
  ): Promise<IMetaMoviePaginated<IMetaMovie[] | []>> {
    try {
      const queryParams = new URLSearchParams({
        language: 'en-US',
        api_key: this.apiKey,
        ...params,
      }).toString();

      const response = await this.client.fetch(`${this.baseUrl}${endpoint}?${queryParams}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return {
          hasNextPage: false,
          currentPage: 0,
          totalResults: 0,
          lastPage: 0,
          data: [],
          error: response.statusText,
          status: response.status,
        };
      }
      const result = await response.json();
      const pagination = {
        currentPage: result.page,
        hasNextPage: result.total_pages > 1,
        totalPages: result.total_pages,
        totalResults: result.total_results,
      };

      const data = result.results.map((item: any) => ({
        tmdbId: item.id || null,
        name: item.title || null,
        originalName: item.original_title || null,
        posterImage: item.poster_path ? `https://image.tmdb.org/t/p/original${item.poster_path}` : null,
        backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
        language: item.original_language || null,
        releaseDate: item.release_date || null,
        summary: item.overview || null,
        genres: item.genre_ids || null,
        rating: item.vote_average || null,
      }));

      return {
        hasNextPage: pagination.hasNextPage,
        currentPage: pagination.currentPage,
        totalResults: pagination.totalResults,
        lastPage: pagination.totalPages,
        data: data as IMetaMovie[],
      };
    } catch (error) {
      return {
        hasNextPage: false,
        currentPage: 0,
        totalResults: 0,
        lastPage: 0,
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
