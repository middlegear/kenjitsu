import type { ClientOptions } from '../../config/client.js';
import type { IBaseAnimePaginated, IBaseAnime, IBaseAnimeInfo, IAnimeInfoResponse } from '../../types/anime.js';
import type { IResponse, IBase, IBaseMediaInfo, ISourceBaseResponse, IVideoSource } from '../../types/base.js';
import { BaseClass } from './base.js';
/**
 * @class AnimeParser
 * @extends BaseClass
 * * @description
 * An abstract base architecture designed for scraping and parsing streaming platforms.
 * It enforces a consistent contract for fetching external public data (`search`, `fetchAnimeInfo`, `fetchSources`)
 * while encapsulating site-specific HTML parsing via internal protected hooks.
 *
 */
abstract class AnimeParser extends BaseClass {
  /**
   * The root canonical URL of the specific streaming provider target.
   * Used as the base anchor for relative query endpoints and network navigation.
   */
  protected baseUrl: string;
  /**
   * Initializes the base scraper client with site-specific configurations and global HTTP client options.
   *  @param baseUrl - The base web domain or address of the targeted streaming platform.
   * @param options - Configuration settings for the underlying HTTP client engine (headers,fingerprints,rate limits, timeouts).
   * @protected This constructor can only be invoked by derived child implementations via `super()`.
   */
  protected constructor(baseUrl: string, options: ClientOptions) {
    super(options);
    this.baseUrl = baseUrl;
  }

  /**
   * Searches for anime by keyword.
   *
   * @param query Search keyword
   * @param args
   * @returns Search results with anime list
   */
  abstract search(
    query: string,
    ...args: any[]
  ): Promise<IResponse<IBase[] | []>> | Promise<IBaseAnimePaginated<IBaseAnime[] | []>>;

  /**
   * Fetches detailed information about a specific anime, including metadata and episode list.
   *
   * @param id Anime ID (series slug)
   * @returns Anime details with or without  provider episodes
   */
  abstract fetchAnimeInfo(
    id: string,
  ): Promise<IResponse<IBaseAnimeInfo | null>> | Promise<IAnimeInfoResponse<IBaseMediaInfo | null>>;

  /**
   * Fetches streaming sources for a given episode.
   *
   * @param episodeId Episode identifier (or direct server URL if starts with http)
   * @param args additional params such as servers, version (audio language )
   * @returns Streaming source data with headers
   */
  abstract fetchSources(episodeId: string, ...args: any[]): Promise<ISourceBaseResponse<IVideoSource | null>>;
}
export { AnimeParser };
