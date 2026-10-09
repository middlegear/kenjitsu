import type { ClientOptions } from '../../config/client.js';

import * as cheerio from 'cheerio';
import type { SelectorType } from 'cheerio';
import type {
  IBase,
  IBaseEpisodes,
  IBaseMediaInfo,
  IResponse,
  ISourceBaseResponse,
  IVideoSource,
} from '../../types/base.js';
import type { IAnimeInfoResponse } from '../../types/anime.js';
import { AnimeParser } from '../models/animeparser.js';

class AnimeHeaven extends AnimeParser {
  constructor(baseUrl: string = 'https://animeheaven.me', options: ClientOptions = {}) {
    super(baseUrl, options);
    this.baseUrl = baseUrl;
  }

  override async search(query: string): Promise<IResponse<IBase[] | []>> {
    if (!query) {
      return { data: [], error: this.formatHttpError(400), status: 400 };
    }
    try {
      const response = await fetch(`${this.baseUrl}/fastsearch.php?xhr=1&s=${decodeURIComponent(query)}`, {
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
      return this.parseSearchResults(cheerio.load(result));
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error.message : 'Unknown err',
        status: 500,
      };
    }
  }
  override async fetchAnimeInfo(id: string): Promise<IAnimeInfoResponse<IBaseMediaInfo | null>> {
    if (!id) {
      return { data: null, providerEpisodes: [], error: this.formatHttpError(400), status: 400 };
    }
    try {
      const response = await this.client.fetch(`${this.baseUrl}/anime.php?${id}`, { method: 'GET' });
      if (!response.ok) {
        return { data: null, providerEpisodes: [], error: response.statusText, status: response.status };
      }
      const result = await response.text();
      return this.parseAnimeinfo(cheerio.load(result));
    } catch (error) {
      return {
        data: null,
        providerEpisodes: [],
        error: error instanceof Error ? error.message : 'Unknown err',
        status: 500,
      };
    }
  }

  override async fetchSources(episodeId: string): Promise<ISourceBaseResponse<IVideoSource | null>> {
    if (!episodeId) {
      return {
        headers: { Referer: null },
        data: null,
        error: 'Missing required params: valid episodeId!',
        status: 400,
      };
    }
    try {
      const id = episodeId.split('-$tk$');
      const key = id.at(0);
      const referer = id.at(-1);
      const response = await this.client.fetch(`${this.baseUrl}/gate.php`, {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Referer: `https://animeheaven.me/anime.php?${referer}`,
          Cookie: `key=${key}`,
          // new stuff to force fresh data
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
      });
      if (!response.ok) {
        return {
          headers: { Referer: null },
          data: null,
          error: response.statusText,
          status: response.status,
        };
      }

      const result = await response.text();
      return this.parseSources(cheerio.load(result));
    } catch (error) {
      return {
        headers: { Referer: null },
        data: null,
        error: error instanceof Error ? error.message : 'Unknown err',
        status: 500,
      };
    }
  }

  private parseSources($: cheerio.CheerioAPI) {
    const extractedData: IVideoSource = {
      sources: [],
    };

    $('div.info2.bc1 > video > source').each((_, element) => {
      const url = $(element).attr('src');

      // Skip invalid/error URLs
      if (!url || url.includes('error')) return;

      extractedData.sources.push({
        url,
        isM3u8: url.includes('m3u8'),
        type: $(element).attr('type') || null,
      });
    });

    return {
      headers: { Referer: `${this.baseUrl}/` },
      data: extractedData,
    };
  }
  private parseAnimeinfo($: cheerio.CheerioAPI) {
    const animeinfo: IBaseMediaInfo = {
      id: $('meta[property="og:url"]').attr('content')?.split('?')[1] || null,
      name: $('div.infotitle.c').text().trim() || null,
      posterImage: $('div.infoimg > img.posterimg').attr('src') || null,
      synopsis: $('div.infodes.c').text().trim() || null,
      type: null,
      releaseDate: $('div.infoyear.c > div.inline.c2').eq(1).text().trim() || null,
      totalEpisodes: Number($('div.infoyear.c > div.inline.c2').eq(0).text().trim()) || null,
      genres: $('div.infotags.c a div.boxitem')
        .map((_, el) => $(el).text().trim())
        .get(),
    };

    const episodes: IBaseEpisodes[] = $('div.boldtext  a[id]')
      .map((_, el) => {
        const episodeId = $(el).attr('id');
        const episodeNumber = Number($(el).find('.watch2').first().text().trim());

        return episodeId && !Number.isNaN(episodeNumber)
          ? {
              episodeId: `${episodeId}-$tk$-${animeinfo.id}`,
              episodeNumber,
            }
          : null;
      })
      .get()
      .reverse();

    return {
      data: animeinfo,
      providerEpisodes: episodes,
    };
  }
  private parseSearchResults($: cheerio.CheerioAPI) {
    const selector: SelectorType = 'a';
    const results: IBase[] = [];
    $(selector).each((_, element) => {
      results.push({
        id: $(element).attr('href')?.split('/').at(-1)?.replace('anime.php?', '').trim() || null,
        name: $(element).find('div.fastname').text().trim() || null,
        posterImage: $(element).find('img.coverimg').attr('src')
          ? `${this.baseUrl}${$(element).find('img.coverimg').attr('src')}`
          : null,
      });
    });
    return { data: results };
  }
}
export { AnimeHeaven };
