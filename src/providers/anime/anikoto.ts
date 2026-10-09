import type { ClientOptions } from '../../config/client.js';
import * as cheerio from 'cheerio';
import type { IAnimeCategory, IBase, IResponse, ISourceBaseResponse, IVideoSource } from '../../types/base.js';

import {
  IGenres,
  type AnikotoServers,
  type IAnimeInfoResponse,
  type IAnimeServerInfo,
  type IBaseAnime,
  type IBaseAnimeEpisodes,
  type IBaseAnimeHomeResponse,
  type IBaseAnimeInfo,
  type IBaseAnimePaginated,
  type ISubOrDub,
  type ScheduleDay,
} from '../../types/anime.js';

import { AnimeParser } from '../models/animeparser.js';
import { MegaPlay } from '../extractors/megaplay.js';

/**
 * Anikoto (anikototv.to) anime scraper.
 *
 * Provides methods to search for anime, fetch detailed information, retrieve episode lists,
 * get available streaming servers, and access curated anime lists (most popular, recently updated, etc.).
 */
export class Anikoto extends AnimeParser {
  private MegaPlay: MegaPlay;
  constructor(baseUrl = 'https://anikototv.to', options: ClientOptions = {}) {
    super(baseUrl, options);
    this.baseUrl = baseUrl;
    this.MegaPlay = new MegaPlay(options);
  }

  /**
   * Fetches the home page data including spotlight, recent updates, upcoming anime, and categorized sections.
   */
  async fetchHome(): Promise<IBaseAnimeHomeResponse<IBaseAnime[] | []>> {
    try {
      const response = await this.client.fetch(`${this.baseUrl}/home`, {
        method: 'GET',
      });
      if (!response.ok) {
        return {
          data: [],
          error: response.statusText,
          status: response.status,
          recentlyUpdated: [],
          upcoming: [],
          sections: {
            recentlyAdded: [],
            recentlyReleased: [],
            recentlyCompleted: [],
          },
          topAnime: {
            day: [],
            week: [],
            month: [],
          },
        };
      }
      const result = await response.text();
      return this.parseHome(cheerio.load(result));
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error.message : 'Unknown Error',
        status: 500,
        recentlyUpdated: [],
        upcoming: [],
        sections: {
          recentlyAdded: [],
          recentlyReleased: [],
          recentlyCompleted: [],
        },
        topAnime: {
          day: [],
          week: [],
          month: [],
        },
      };
    }
  }

  /**
   * Fetches the anime schedule .
   *
   * @param timezone - User timezone offset in hours (numeric value, e.g. 3, -5, 0)
   *
   * @returns A parsed schedule structure or an error object if the request fails
   *
   * @example
   * fetchSchedule(3); // UTC+3
   * fetchSchedule(-5); // UTC-5
   */
  async fetchSchedule(timezone: number): Promise<IResponse<ScheduleDay[] | []>> {
    try {
      const response = await this.client.fetch(`${this.baseUrl}/ajax/schedule?tz=${timezone}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          Referer: `${this.baseUrl}/home}`,
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      if (!response.ok) {
        return {
          data: [],
          error: response.statusText,
          status: response.status,
        };
      }

      const result = await response.json();
      return this.parseSchedule(cheerio.load(result.result));
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error.message : 'Unknown err',
        status: 500,
      };
    }
  }

  /**
   * Searches for anime by keyword.
   *
   * @param query Search keyword
   * @param page
   * @returns Search results with anime list
   */
  async search(query: string, page: number = 1): Promise<IBaseAnimePaginated<IBaseAnime[] | []>> {
    const finalUrl = page > 1 ? `filter?keyword=${query}?page=${page}` : `filter?keyword=${query}`;
    return await this.fetchPaginatedSections(finalUrl.trim());
  }

  /**
   * Fetches search suggestions for a given query string .
   * @param  query - The search query string (required).
    @returns A promise that resolves to an object containing an array of anime titles or an error message.
   */
  async searchSuggestions(query: string): Promise<IResponse<IBaseAnime[] | []>> {
    if (!query) {
      return {
        data: [],
        error: this.formatHttpError(400),
        status: 400,
      };
    }
    try {
      const response = await this.client.fetch(`${this.baseUrl}/ajax/anime/search?keyword=${query}`, {
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          Referer: `${this.baseUrl}/home}`,
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      if (!response.ok) {
        return {
          data: [],
          error: response.statusText,
          status: response.status,
        };
      }

      const result = await response.json();

      return this.parseSearchSuggessations(cheerio.load(result.result.html));
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error.message : 'Unknown err',
        status: 500,
      };
    }
  }

  /**
   * Fetches detailed information about a specific anime, including metadata and episode list.
   *
   * @param id Anime ID (series slug)
   * @returns Anime details + provider episodes
   */
  async fetchAnimeInfo(id: string): Promise<IAnimeInfoResponse<IBaseAnimeInfo | null>> {
    if (!id) {
      return {
        data: null,
        providerEpisodes: [],
        error: 'Missing required params :id',
        status: 400,
      };
    }
    try {
      const response = await this.client.fetch(`${this.baseUrl}/watch/${id}`, {
        method: 'GET',
      });
      if (!response.ok) {
        return {
          data: null,
          providerEpisodes: [],
          error: response.statusText,
          status: response.status,
        };
      }
      const result = await response.text();
      const info = this.parseAnimeinfo(cheerio.load(result));
      const episodeResponse = await this.client.fetch(`${this.baseUrl}/ajax/episode/list/${info.seriesId}?vrf=`, {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          Referer: `${this.baseUrl}/${id}`,
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      if (!episodeResponse.ok) {
        return {
          data: null,
          providerEpisodes: [],
          error: episodeResponse.statusText,
          status: episodeResponse.status,
        };
      }

      const episodeResult = await episodeResponse.json();
      const episodes = this.parseEpisodes(cheerio.load(episodeResult.result));
      return {
        data: info,
        providerEpisodes: episodes.data,
      };
    } catch (error) {
      return {
        data: null,
        providerEpisodes: [],
        error: error instanceof Error ? error.message : 'Unknown err',
        status: 500,
      };
    }
  }

  /**
   * Fetches detailed information about a specific anime, including metadata and episode list.
   *
   * @param id Anime ID (series slug)
   * @returns  provider episodes
   */
  async fetchProviderEpisodes(id: string): Promise<IResponse<IBaseAnimeEpisodes[] | []>> {
    if (!id) {
      return {
        data: [],
        error: 'Missing required params :id',
        status: 400,
      };
    }
    try {
      const response = await this.client.fetch(`${this.baseUrl}/watch/${id}`, {
        method: 'GET',
      });
      if (!response.ok) {
        return {
          data: [],
          error: response.statusText,
          status: response.status,
        };
      }
      const result = await response.text();
      const info = this.parseAnimeinfo(cheerio.load(result));
      const episodeResponse = await this.client.fetch(`${this.baseUrl}/ajax/episode/list/${info.seriesId}?vrf=`, {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          Referer: `${this.baseUrl}/${id}`,
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      if (!episodeResponse.ok) {
        return {
          data: [],
          error: episodeResponse.statusText,
          status: episodeResponse.status,
        };
      }

      const episodeResult = await episodeResponse.json();
      const episodes = this.parseEpisodes(cheerio.load(episodeResult.result));
      return {
        data: episodes.data,
      };
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error.message : 'Unknown err',
        status: 500,
      };
    }
  }

  /**
   * Fetches a paginated list of most popular anime.
   * @param page Page number (default: 1)
   */
  async fetchMostPopular(page: number = 1): Promise<IBaseAnimePaginated<IBaseAnime[] | []>> {
    const finalUrl = page > 1 ? `most-viewed?page=${page}` : `most-viewed`;
    return await this.fetchPaginatedSections(finalUrl.trim());
  }

  /**
   * Fetches a paginated list of recently updated anime.
   * @param page Page number (default: 1)
   */
  async fetchRecentlyUpdated(page: number = 1): Promise<IBaseAnimePaginated<IBaseAnime[] | []>> {
    const finalUrl = page > 1 ? `latest-updated?page=${page}` : `latest-updated`;
    return await this.fetchPaginatedSections(finalUrl.trim());
  }

  /**
   * Fetches a paginated list of recently added anime.
   * @param page Page number (default: 1)
   */
  async fetchRecentlyAdded(page: number = 1): Promise<IBaseAnimePaginated<IBaseAnime[] | []>> {
    const finalUrl = page > 1 ? `new-release?page=${page}` : `new-release`;
    return await this.fetchPaginatedSections(finalUrl.trim());
  }

  /**
   * Fetches a paginated list of upcoming (not yet aired) anime.
   * @param page Page number (default: 1)
   */
  async fetchUpcoming(page: number = 1): Promise<IBaseAnimePaginated<IBaseAnime[] | []>> {
    const finalUrl = page > 1 ? `status/not-yet-aired?page=${page}` : `status/not-yet-aired`;
    return await this.fetchPaginatedSections(finalUrl.trim());
  }

  /**
   * Fetches a paginated list of currently releasing anime.
   * @param page Page number (default: 1)
   */
  async fetchReleasing(page: number = 1): Promise<IBaseAnimePaginated<IBaseAnime[] | []>> {
    const finalUrl = page > 1 ? `status/currently-airing?page=${page}` : `status/currently-airing`;
    return await this.fetchPaginatedSections(finalUrl.trim());
  }

  /**
   * Fetches a paginated list of recently completed anime.
   * @param page Page number (default: 1)
   */
  async fetchRecentlyCompleted(page: number = 1): Promise<IBaseAnimePaginated<IBaseAnime[] | []>> {
    const finalUrl = page > 1 ? `status/finished-airing?page=${page}` : `status/finished-airing`;
    return await this.fetchPaginatedSections(finalUrl.trim());
  }

  /**
   * Fetches a paginated list of anime by category (TV, Movie, ONA, etc.).
   * @param format Anime category
   * @param page Page number (default: 1)
   */
  async fetchAnimeCategory(format: IAnimeCategory, page: number = 1): Promise<IBaseAnimePaginated<IBaseAnime[] | []>> {
    let category: string;
    switch (format) {
      case 'MOVIE':
        category = 'movie';
        break;
      case 'TV':
        category = 'tv';
        break;
      case 'ONA':
        category = 'ona';
        break;
      case 'OVA':
        category = 'ova';
        break;
      case 'SPECIALS':
        category = 'special';
        break;
      default:
        return {
          hasNextPage: false,
          currentPage: 0,
          lastPage: 0,
          data: [],
          error: this.formatHttpError(400),
          status: 400,
        };
    }
    const finalUrl = page > 1 ? `type/${category}?page=${page}` : `type/${category}`;
    return this.fetchPaginatedSections(finalUrl.trim());
  }

  /**
   * Fetches a list of anime titles sorted alphabetically, optionally filtered by a starting character.
   * @param  sort Optional letter (A-Z) or "0-9" to filter anime
   * @param  page - Page number for pagination (default: 1)
   * @returns  Promise resolving to an object  with alphabetically sorted anime and pagination details
   */
  async fetchAtoZList(sort?: any, page: number = 1): Promise<IBaseAnimePaginated<IBaseAnime[] | []>> {
    const sortValue = (sort ?? '').toString().trim();

    const sortCategory = !sortValue
      ? undefined
      : !Number.isNaN(Number(sortValue))
        ? '0-9'
        : sortValue.length === 1
          ? sortValue.toUpperCase()
          : 'other';
    const baseUrl = sortCategory ? `az-list/${sortCategory}` : `az-list`;
    const finalUrl = page > 1 ? `${baseUrl}?page=${page}` : baseUrl;
    return await this.fetchPaginatedSections(finalUrl);
  }

  /**
   * Fetches a list of anime by genre.
   * @param  genre -The genre to filter anime by
   * @param  page - Page number for pagination (default: 1)
   * @returns  Promise resolving to an object with genre-specific anime and pagination details
   */
  async fetchGenre(genre: string, page: number = 1) {
    const Igenre = this.getMappedValue(genre, IGenres);
    const finalUrl = page > 1 ? `genre/${Igenre}?page=${page}` : `genre/${Igenre}`;
    return await this.fetchPaginatedSections(finalUrl);
  }

  /**
   * Fetches available streaming servers for a specific episode.
   *
   * @param episodeId Episode identifier
   * @returns Server information grouped by sub/dub/raw
   */
  async fetchServers(episodeId: string): Promise<IResponse<IAnimeServerInfo | null>> {
    if (!episodeId) {
      return {
        data: null,
        error: 'Missing required params: valid episodeId!',
        status: 400,
      };
    }
    try {
      const response = await this.client.fetch(`${this.baseUrl}/ajax/server/list?servers=${episodeId}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
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
      const servers = this.parseServers(cheerio.load(result.result));
      return {
        data: servers,
      };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Unknown err',
        status: 500,
      };
    }
  }

  /**
   * Fetches streaming sources for a given episode.
   *
   * @param episodeId Episode identifier (or direct server URL if starts with http)
   * @param version Audio version - `'sub'` or `'dub'` (default: `'sub'`)
   * @param server Preferred server name (default: `'vidstream-2'`)
   * @returns Streaming source data with headers
   */
  async fetchSources(
    episodeId: string,
    version: ISubOrDub = 'sub',
    server: AnikotoServers = 'vidstream-2',
  ): Promise<ISourceBaseResponse<IVideoSource | null>> {
    if (!episodeId) {
      return {
        headers: { Referer: null },
        data: null,
        error: 'Missing required params: valid episodeId!',
        status: 400,
      };
    }
    //// remeber to clean this up and refactor it as one extractor
    if (episodeId.startsWith('http')) {
      const serverUrl = new URL(episodeId);
      switch (server) {
        case 'vidstream-2':
        case 'hd-1':
        case 'hd-2':
          return {
            headers: { Referer: `${serverUrl.origin}/` },
            data: (await this.MegaPlay.extract(serverUrl, `${this.baseUrl}/`)).data,
          };
        default:
          return {
            headers: { Referer: null },
            data: null,
            error: 'Unsupported, might add more options soon',
            status: 400,
          };
      }
    }
    try {
      const serverInfo = await this.fetchServers(episodeId);
      if (serverInfo.error || serverInfo.data === null) {
        return {
          error: serverInfo.error,
          headers: { Referer: null },
          data: null,
          status: serverInfo.status,
        };
      }
      const serverId = this.findServerId(serverInfo.data, version, server);
      const response = await this.client.fetch(`${this.baseUrl}/ajax/server?get=${serverId}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      const result = await response.json();
      return await this.fetchSources(result.result.url, version, server);
    } catch (error) {
      return {
        headers: { Referer: null },
        data: null,
        error: error instanceof Error ? error.message : 'Unknown Error',
        status: 500,
      };
    }
  }

  /**
   * Parses anime items from home page sections.
   * @param $ Cheerio instance
   * @param selector CSS selector for the anime items
   */
  private parseHomeAnimeSectoons = ($: cheerio.CheerioAPI, selector: string): IBaseAnime[] => {
    const items: IBaseAnime[] = [];
    $(selector).each((_, element) => {
      const ep = $(element).find('.ep-status');
      const href = $(element).find('div.info > a').attr('href');
      const id = href?.includes('ep') ? href.split('/').at(-2) : href?.split('/').at(-1);
      items.push({
        id: id || null,
        name: $(element).find('div.info > a').text().trim() || null,
        romaji: $(element).find('div.info > a').attr('data-jp') || null,
        posterImage: $(element).find('img').attr('src') || null,
        type: $(element).find('.meta .right').text().trim() || null,
        episodes: {
          sub: Number(ep.filter('.sub').text().trim()) || null,
          dub: Number(ep.filter('.dub').text().trim()) || null,
        },
        totalEpisodes: Number(ep.filter('.total').text().trim()) || Number(ep.filter('.sub').text().trim()) || null,
      });
    });
    return items;
  };

  /**
   * Parses newly added/completed/released anime items.
   * @param $ Cheerio instance
   * @param selector CSS selector for the items
   */
  private parseNewAddedItems = ($: cheerio.CheerioAPI, selector: string): IBaseAnime[] => {
    const items: IBaseAnime[] = [];
    $(selector).each((_, element) => {
      items.push({
        id: $(element).attr('href')?.split('/').filter(Boolean).at(-1) || null,
        name: $(element).find('.name.d-title').text().trim() || null,
        romaji: $(element).find('.name.d-title').attr('data-jp') || null,
        posterImage: $(element).find('.poster img').attr('src') || null,
        type: $(element).find('.meta.one-line .dot:nth-child(2)').text().trim() || null,
        episodes: {
          sub: Number($(element).find('.ep-status.sub > span').text().trim()) || null,
          dub: Number($(element).find('.ep-status.dub > span').text().trim()) || null,
        },
        totalEpisodes: Number($(element).find('.ep-status.sub > span').text().trim()) || null,
      });
    });
    return items;
  };

  /**
   * Parses top  anime items.
   * @param $ Cheerio instance
   * @param selector CSS selector for the items
   */
  private parseTopAnimeSegement($: cheerio.CheerioAPI, tabName: string) {
    const selector: cheerio.SelectorType = `#top-anime .tab-content[data-name="${tabName}"] .scaff.items .item`;
    const results: IBaseAnime[] = [];

    $(selector).each((_, element) => {
      results.push({
        id: $(element).attr('href')?.split('/').at(-1) || null,
        name: $(element).find('.name').text().trim() || null,
        romaji: $(element).find('.name').attr('data-jp')?.trim() || null,
        rank:
          Number(
            $(element)
              .attr('class')
              ?.split(' ')
              .find(c => c.startsWith('rank'))
              ?.replace('rank', ''),
          ) || 0,

        posterImage: $(element).find('.poster img').attr('src') ?? '',
        type: $(element).find('.meta .dot:not(.ep-wrap)').first().text().trim() || null,
        episodes: {
          sub: Number($(element).find('.ep-status.sub > span').first().text().trim()) || null,
          dub: Number($(element).find('.ep-status.dub > span').first().text().trim()) || null,
        },
        totalEpisodes: Number($(element).find('.ep-status.sub > span').first().text().trim()) || null,
      });
    });

    return results;
  }

  /**
   * Parses the home page content including spotlight, recent updates, upcoming, etc.
   * @param $ Cheerio instance with loaded home page HTML
   */
  private parseHome($: cheerio.CheerioAPI) {
    const highlightsSelector: cheerio.SelectorType = 'div#hotest > div.swiper-wrapper > div.swiper-slide.item ';
    const spotlight: IBaseAnime[] = [];
    $(highlightsSelector).each((_, element) => {
      const icons = $(element).find('div.meta.icons');
      spotlight.push({
        id: $(element).find('div.actions > a').attr('href')?.split('/').at(-1) || null,
        name: $(element).find('div.info > h2.title.d-title').text().trim() || null,
        romaji: $(element).find('div.info > h2.title.d-title').attr('data-jp') || null,
        posterImage:
          $(element)
            .find('div.image > div')
            .attr('style')
            ?.match(/url\(['"]?(.*?)['"]?\)/)?.[1] ?? null,
        synopsis: $(element).find('div.synopsis').text().trim() || null,
        rating: icons.find('i.rating').text().trim() || null,
        quality: icons.find('i.quality').text().trim() || null,
        episodes: {
          dub: Number($(element).find('.ep-status.dub > span').first().text().trim()) || icons.find('i.dub').length > 0,
          sub: Number($(element).find('.ep-status.sub > span').first().text().trim()) || icons.find('i.sub').length > 0,
        },
      });
    });
    const latestEpisodesSelector = 'section#recent-update div.ani.items > div.item';
    const upcomingSelector = 'section#upcoming-anime div.ani.items > div.item';
    const recentUpdated = this.parseHomeAnimeSectoons($, latestEpisodesSelector);
    const upcomingAnime = this.parseHomeAnimeSectoons($, upcomingSelector);
    const recentlyCompletedSelector: cheerio.SelectorType =
      'section.top-table[data-name="completed"] div.body .scaff.items a.item';
    const recentlyAddedSelector: cheerio.SelectorType =
      'section.top-table[data-name="new-added"] div.body .scaff.items a.item';
    const recentlyReleasedSelector: cheerio.SelectorType =
      'section.top-table[data-name="new-release"] div.body .scaff.items a.item';
    const recentlyCompleted = this.parseNewAddedItems($, recentlyCompletedSelector);
    const recentlyAdded = this.parseNewAddedItems($, recentlyAddedSelector);
    const recentlyReleased = this.parseNewAddedItems($, recentlyReleasedSelector);
    return {
      data: spotlight,
      recentlyUpdated: recentUpdated,
      upcoming: upcomingAnime,
      sections: {
        recentlyAdded: recentlyAdded,
        recentlyReleased: recentlyReleased,
        recentlyCompleted: recentlyCompleted,
      },
      topAnime: {
        day: this.parseTopAnimeSegement($, 'day'),
        week: this.parseTopAnimeSegement($, 'week'),
        month: this.parseTopAnimeSegement($, 'month'),
      },
    };
  }

  /**
   * Parses the schedule from ajax html
   * @param $ Cheerio instance with loaded home page HTML
   */
  private parseSchedule($: cheerio.CheerioAPI) {
    const days: ScheduleDay[] = [];

    const dayHeaders: { day: string; date: string; timestamp: number | null }[] = [];

    $('#schedule .days .day').each((_, element) => {
      const $day = $(element);
      const dayName = $day.find('.inner .wday').text().trim() || $day.find('.wday').text().trim();
      const date = $day.find('.inner .date').text().trim() || $day.find('.date').text().trim();
      const timestamp = Number($day.find('.inner').attr('data-time')) || null;
      if (!dayName && !date) return;
      dayHeaders.push({
        day: dayName,
        date,
        timestamp,
      });
    });

    const animes: IBase[] = [];

    $('#schedule .body .items .item').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href') ?? '';
      const slug = href
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/watch\//, '')
        .replace(/\/ep-\d+$/, '')
        .replace(/\/$/, '');

      animes.push({
        id: slug,
        name: $el.find('.title, .d-title').text().trim(),
        episode: $el.find('.ep span').text().trim() || null,
        time: $el.find('.time').text().trim() || null,
      });
    });

    const perDay = Math.ceil(animes.length / dayHeaders.length);

    dayHeaders.forEach((d, i) => {
      days.push({
        ...d,
        anime: animes.slice(i * perDay, (i + 1) * perDay),
      });
    });

    return { data: days };
  }

  /**
   * Parses detailed anime information from the watch/info page.
   * @param $ Cheerio instance
   */
  private parseAnimeinfo($: cheerio.CheerioAPI) {
    const selector: cheerio.SelectorType = 'div#w-info div.binfo';
    const root = $(selector);
    const numericId = $('div#watch-main').attr('data-id');
    const seriesId = $('div#watch-main').attr('data-url')?.split('/').at(-1);
    const mediaRoot = $('#w-media');
    const bannerStyle = mediaRoot.find('#player').attr('style') || '';
    const bannerImage = bannerStyle.match(/url\(['"]?(.*?)['"]?\)/)?.[1] || null;
    const anilistId = bannerImage?.match(/anime\/banner\/(\d+)-/)?.[1] || null;
    const info: IBaseAnimeInfo = {
      id: seriesId || null,
      name: root.find('div.info > h1.title.d-title').text().trim() || null,
      romaji:
        root.find('div.info > h1.title.d-title').attr('data-jp') ||
        root.find('div.info div.names.font-italic.mb-2').text().trim() ||
        null,
      posterImage: root.find('div.poster > span > img').attr('src') || null,
      anilistId: anilistId || null,
      bannerImage: bannerImage || null,
      totalEpisodes:
        parseInt(
          root
            .find('div.meta > div')
            .filter((_, el) => $(el).text().includes('Episodes:'))
            .find('span')
            .text()
            .trim(),
          10,
        ) || null,
      synopsis: root.find('div.content').text().trim() || null,
      score:
        parseFloat(
          root
            .find('div.meta > div')
            .filter((_, el) => $(el).text().includes('MAL:'))
            .find('span')
            .text()
            .trim(),
        ) || null,
      releaseDate:
        root
          .find('div.meta > div')
          .filter((_, el) => $(el).text().includes('Aired:'))
          .find('span')
          .text()
          .trim() || null,
      genre: root
        .find('div.meta > div')
        .filter((_, el) => $(el).text().includes('Genres:'))
        .find('a')
        .map((_, el) => $(el).text().trim())
        .get(),
      type:
        root
          .find('div.meta > div')
          .filter((_, el) => $(el).text().includes('Type:'))
          .find('span')
          .text()
          .trim() || null,
      premiered:
        root
          .find('div.meta > div')
          .filter((_, el) => $(el).text().includes('Premiered:'))
          .find('span')
          .text()
          .trim() || null,
      status:
        root
          .find('div.meta > div')
          .filter((_, el) => $(el).text().includes('Status:'))
          .find('span')
          .text()
          .trim() || null,
      duration:
        root
          .find('div.meta > div')
          .filter((_, el) => $(el).text().includes('Duration:'))
          .find('span')
          .text()
          .trim() || null,
      studios: root
        .find('div.meta > div')
        .filter((_, el) => $(el).text().includes('Studios:'))
        .find('a span[itemprop="name"]')
        .map((_, el) => $(el).text().trim())
        .get(),
      producers: root
        .find('div.meta > div')
        .filter((_, el) => $(el).text().includes('Producers:'))
        .find('a span[itemprop="name"]')
        .map((_, el) => $(el).text().trim())
        .get(),
      seriesId: numericId,
    };
    return info;
  }

  /**
   * Parses paginated anime results (used for most popular, recently updated, etc.).
   * @param $ Cheerio instance
   */
  private parsePaginatedSections($: cheerio.CheerioAPI) {
    const selector: cheerio.SelectorType = 'div#list-items  > div.item';
    const anime: IBaseAnime[] = [];
    $(selector).each((_, element) => {
      const href = $(element).find('div.ani.poster.tip > a').attr('href');
      const id = href?.includes('ep') ? href.split('/').at(-2) : href?.split('/').at(-1);
      anime.push({
        id: id || null,
        name: $(element).find('div.b1 > a.name.d-title').text().trim() || null,
        romaji: $(element).find('div.b1 > a.name.d-title').attr('data-jp') || null,
        posterImage: $(element).find('div.ani.poster.tip img').attr('src') || null,
        type: $(element).find('div.meta div.right').text().trim() || null,
        episodes: {
          sub: Number($(element).find('div.left .ep-status.sub > span').first().text().trim()) || null,
          dub: Number($(element).find('div.left .ep-status.dub > span').first().text().trim()) || null,
        },
        totalEpisodes:
          Number($(element).find('div.left .ep-status.total > span').first().text().trim()) ||
          Number($(element).find('div.left .ep-status.sub > span').first().text().trim()) ||
          null,
      });
    });
    const activeText = $('.pagination .page-item.active .page-link').first().text().trim();
    const currentPage = Number(activeText) || 1;
    const lastPageText = $('.pagination .page-item a[title="Last"]')
      .attr('href')
      ?.match(/page=(\d+)/)?.[1];
    const lastPage = lastPageText ? Number(lastPageText) : null;
    const nextHref = $('.pagination .page-item a[rel="next"]').attr('href');
    const hasNextPage = Boolean(nextHref) || (lastPage !== null && Number.isFinite(lastPage) && currentPage < lastPage);
    if (Array.isArray(anime) && anime.length === 0) {
      return { data: [], error: 'No results found', status: 404, hasNextPage: false, currentPage: 0, lastPage: 0 };
    }
    return { hasNextPage: hasNextPage, currentPage: currentPage, lastPage: lastPage, data: anime };
  }

  /**
   * Parses episode list from AJAX response.
   * @param $ Cheerio instance
   */
  private parseEpisodes($: cheerio.CheerioAPI) {
    const selector: cheerio.SelectorType = 'div.body    ul.ep-range  li';
    const episodes: IBaseAnimeEpisodes[] = [];
    $(selector).each((_, element) => {
      const sub = Number($(element).find('a').attr('data-sub')) === 1;
      const dub = Number($(element).find('a').attr('data-dub')) === 1;
      episodes.push({
        episodeId: $(element).find('a').attr('data-ids')?.replace('&eps=', '-episode-') || null,
        title: $(element).attr('title') || null,
        episodeNumber: Number($(element).find('a').attr('data-num')) || null,
        hasSub: sub,
        hasDub: dub,
        malId: $(element).find('a').attr('data-mal') ? Number($(element).find('a').attr('data-mal')) : null,
      });
    });
    if (Array.isArray(episodes) && episodes.length === 0) {
      return { data: [], error: 'No episodes found', status: 404 };
    }
    return { data: episodes };
  }

  /**
   * Parses available streaming servers for an episode.
   * @param $ Cheerio instance
   */
  private parseServers($: cheerio.CheerioAPI): IAnimeServerInfo {
    const servers: IAnimeServerInfo = {
      sub: [],
      dub: [],
      raw: [],
      episodeNumber: 0,
    };

    const episodeText = $('div.tip b').first().text().trim();
    const match = episodeText.match(/(\d+)/);
    if (match) {
      servers.episodeNumber = parseInt(match[1], 10);
    }

    $('div.servers div.type').each((_, element) => {
      const $type = $(element);
      const type = $type.attr('data-type');

      $type.find('ul li').each((_, li) => {
        const $li = $(li);
        const serverName = $li.text().trim().toLowerCase() || null;

        const server = {
          serverId: $li.attr('data-sv-id') ?? null,
          serverName: serverName,
          mediaId: $li.attr('data-cmid') ?? null,
          eid: $li.attr('data-link-id') ?? null,
        };

        if (type === 'sub') {
          servers.sub.push(server);
        } else if (type === 'dub') {
          servers.dub.push(server);
        } else {
          // hsub will live here
          servers.raw.push(server);
        }
      });
    });
    return servers;
  }

  /**
   * Parses search suggestion results from a Cheerio instance.
   * Extracts anime suggestion details from the provided HTML.
   * @param $ CheerioAPI instance
   * @returns An array containing an array of search suggestions
   */
  private parseSearchSuggessations($: cheerio.CheerioAPI) {
    const results: IBaseAnime[] = [];

    $('.scaff.items a.item').each((_, element) => {
      $(element);
      const href = $(element).attr('href') || null;
      const dots = $(element).find('.meta .dot');
      const scoreText = dots
        .eq(1)
        .text()
        .replace(/[^0-9.]/g, '')
        .trim();

      results.push({
        id: href?.split('/watch/').pop() || null,
        name: $(element).find('.name.d-title').text().trim() || null,
        romaji: $(element).find('.name.d-title').attr('data-jp') || null,
        posterImage: $(element).find('.poster img').attr('src') || null,
        rating: dots.eq(0).text().trim() || null,
        score: scoreText ? Number(scoreText) : null,
        type: dots.eq(2).text().trim() || null,
        year: Number(dots.eq(3).text().trim()) || null,
      });
    });
    if (Array.isArray(results) && results.length === 0) {
      return { data: [], error: this.formatHttpError(400), status: 404 };
    }
    return { data: results };
  }

  /**
   * Finds the best matching server ID based on preferences.
   *
   * Preference order:
   * - Exact server match in requested version (sub/dub)
   * - Preferred servers: `vidstream-2`, `vidcloud-1`
   * - Fallback to other available version if requested one is unavailable
   *
   * @param servers Server information from `fetchServers`
   * @param category Requested version (`sub` or `dub`)
   * @param server Preferred server name
   * @returns Media ID (eid) of the selected server
   * @throws Error if no servers are available
   */
  private findServerId(servers: IAnimeServerInfo, category: ISubOrDub, server: AnikotoServers): string {
    const serverPreference: AnikotoServers[] = ['vidstream-2', 'vidcloud-1'];
    const versionPreference: ISubOrDub[] = ['sub', 'dub'];
    const versionCandidates: ISubOrDub[] = [category, ...versionPreference.filter(v => v !== category)];
    let selectedMediaId: string | null = null;
    let usedVersion: ISubOrDub | null = null;
    let usedServer: AnikotoServers | null = null;
    for (const ver of versionCandidates) {
      const list = servers[ver];
      if (!list || list.length === 0) continue;
      const exactIdx = list.findIndex(s => (s.serverName || '').toLowerCase() === server.toLowerCase());
      if (exactIdx !== -1) {
        selectedMediaId = list[exactIdx].eid as string;
        usedVersion = ver;
        usedServer = server;
        break;
      }
      for (const pref of serverPreference) {
        const prefIdx = list.findIndex(s => (s.serverName || '').toLowerCase() === pref.toLowerCase());
        if (prefIdx !== -1) {
          selectedMediaId = list[prefIdx].eid as string;
          usedVersion = ver;
          usedServer = pref;
          break;
        }
      }
      if (selectedMediaId !== null) break;
    }
    if (selectedMediaId === null) {
      const available = versionPreference.filter(v => servers[v]?.length > 0).join(', ') || 'none';
      throw new Error(`No servers available in any version. Available versions: ${available}.`);
    }
    const requestedServerLower = server.toLowerCase();
    const usedServerLower = usedServer!.toLowerCase();
    if (usedVersion !== category) {
      console.warn(`Fallback: version '${category}' not available → using '${usedVersion}' with server '${usedServer}'.`);
    } else if (usedServerLower !== requestedServerLower) {
      const serversInVersion = servers[category].map(s => s.serverName || 'unknown').join(', ');
      console.warn(
        `Fallback: server '${server}' not found in '${category}'. Using '${usedServer}'. Available in this version: ${serversInVersion}.`,
      );
    }
    return selectedMediaId;
  }

  /**
   * Internal helper to fetch and parse paginated anime sections.
   * @param url Relative URL for the section
   */
  private async fetchPaginatedSections(url: string): Promise<IBaseAnimePaginated<IBaseAnime[] | []>> {
    if (!url) {
      return {
        hasNextPage: false,
        currentPage: 0,
        lastPage: 0,
        data: [],
        error: this.formatHttpError(400),
        status: 400,
      };
    }
    try {
      const response = await this.client.fetch(`${this.baseUrl}/${url}`, { method: 'GET' });
      if (!response.ok) {
        return {
          hasNextPage: false,
          currentPage: 0,
          lastPage: 0,
          data: [],
          error: response.statusText,
          status: response.status,
        };
      }
      const result = await response.text();

      return this.parsePaginatedSections(cheerio.load(result));
    } catch (error) {
      return {
        hasNextPage: false,
        currentPage: 0,
        lastPage: 0,
        data: [],
        error: error instanceof Error ? error.message : 'Unknown Error',
        status: 500,
      };
    }
  }
}
