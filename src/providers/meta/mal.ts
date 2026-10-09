import * as cheerio from 'cheerio';

import type { ClientOptions } from '../../config/client.js';
import type { IMetaAnime, IMetaAnimeEpisode } from '../../types/meta/meta-anime.js';
import type { IResponse } from '../../types/base.js';
import { BaseClass } from '../models/base.js';

class MyAnimeList extends BaseClass {
  private readonly baseUrl: string;
  constructor(
    baseUrl: string = 'https://myanimelist.net',
    // Reasonal requests to avoid rate limits
    options: ClientOptions = { rateLimit: { requestsPerInterval: 1, intervalMs: 700, concurrency: 1 }, browser: 'okhttp5' },
  ) {
    super(options);
    this.baseUrl = baseUrl;
  }

  async search(query: string): Promise<IResponse<IMetaAnime[] | []>> {
    try {
      const response = await this.client.fetch(
        `${this.baseUrl}/search/prefix.json?type=anime&keyword=${encodeURIComponent(query)}&v=1`,
        {
          method: 'GET',
        },
      );

      if (!response.ok) {
        return {
          data: [],
          error: response.statusText,
          status: response.status,
        };
      }

      const result = await response.json();

      const data: IMetaAnime[] = (result.categories?.[0]?.items ?? []).map((item: any) => ({
        id: item.id?.toString() ?? null,
        isAdult: null,
        image: item.image_url ?? null,
        color: null,
        bannerImage: null,
        title: {
          romaji: item.name ?? null,
          english: item.name ?? null,
          native: null,
        },
        trailer: null,
        format: item.payload?.media_type ?? null,
        status: item.payload?.status ?? null,
        synonyms: [],
        country: null,
        year: item.payload?.start_year ?? null,
        duration: null,
        score: null,
        genres: [],

        episodes: null,

        synopsis: null,

        season: null,

        releaseDate: item.payload?.aired?.from ?? null,

        endDate: item.payload?.aired?.to ?? null,

        studio: null,

        producers: [],
      }));

      return {
        data,
      };
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        status: 500,
      };
    }
  }
  async fetchInfo(id: number): Promise<IResponse<IMetaAnime | null>> {
    try {
      const response = await this.client.fetch(`${this.baseUrl}/anime/${id}/_`, { method: 'GET' });
      if (!response.ok) {
        return { data: null, error: response.statusText, status: response.status };
      }
      const result = await response.text();
      return this.parseAnimeInfo(cheerio.load(result));
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async fetchEpisodes(id: number): Promise<IResponse<IMetaAnimeEpisode[] | []>> {
    try {
      const initialUrl = `${this.baseUrl}/anime/${id}/_/episode`;
      const response = await this.client.fetch(initialUrl, { method: 'GET' });

      if (response.status === 404) {
        // for movies
        return {
          data: [
            {
              airDate: null,
              title: null,
              thumbnail: null,
              isFiller: null,
              episodeNumber: 1,
              summary: null,
            },
          ],
        };
      }

      if (!response.ok) {
        return {
          data: [],
          error: response.statusText,
          status: response.status,
        };
      }

      const firstPageHtml = await response.text();
      const $ = cheerio.load(firstPageHtml);

      let allEpisodes = this.parseEpisodes($);

      const offsets: number[] = [];

      $('.pagination a.link').each((_, el) => {
        const href = $(el).attr('href');

        if (href) {
          const match = href.match(/offset=(\d+)/);

          if (match && match[1]) {
            const offset = parseInt(match[1], 10);

            if (offset > 0 && !offsets.includes(offset)) {
              offsets.push(offset);
            }
          }
        }
      });

      if (offsets.length > 0) {
        const pageResults = await Promise.all(
          offsets.map(async offset => {
            try {
              const pageRes = await this.client.fetch(`${this.baseUrl}/anime/${id}/_/episode?offset=${offset}`, {
                method: 'GET',
              });

              if (!pageRes.ok) return [];

              const html = await pageRes.text();

              return this.parseEpisodes(cheerio.load(html));
            } catch {
              return [];
            }
          }),
        );

        allEpisodes = allEpisodes.concat(...pageResults);
      }

      allEpisodes.sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0));

      return { data: allEpisodes };
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private parseEpisodes($: cheerio.CheerioAPI) {
    const episodes: IMetaAnimeEpisode[] = [];

    $('tr.episode-list-data').each((_, el) => {
      const $el = $(el);

      const epNumRaw = $el.find('.episode-number').attr('data-raw') || $el.find('.episode-number').text().trim();
      const episodeNumber = epNumRaw ? parseInt(epNumRaw, 10) : null;

      const titleAnchor = $el.find('.episode-title a.fw-b');
      const title = titleAnchor.text().trim() || null;

      const typeBadgeText = $el.find('.episode-title .icon-episode-type-bg').text().trim();
      const isFiller = typeBadgeText.toLowerCase() === 'filler';

      const airDateRaw = $el.find('.episode-aired').text().trim();
      const aired = !!(airDateRaw && airDateRaw !== 'N/A');
      const airDate = airDateRaw && airDateRaw !== 'N/A' ? airDateRaw : null;

      const ratingRaw = $el.find('.episode-poll').attr('data-raw') || $el.find('.episode-poll .value').text().trim();
      const rating = ratingRaw ? parseFloat(ratingRaw) : null;

      if (episodeNumber !== null) {
        episodes.push({
          episodeNumber: !isNaN(episodeNumber) ? episodeNumber : null,
          title,
          isFiller,
          aired,
          airDate,
          rating: rating && !isNaN(rating) ? rating : null,
          thumbnail: null,
          summary: null,
        });
      }
    });

    return episodes;
  }

  private parseAnimeInfo($: cheerio.CheerioAPI) {
    const getSidebar = (label: string) =>
      $(`.spaceit_pad:contains("${label}")`).contents().not('.dark_text').text().replace(/\s+/g, ' ').trim() || null;

    const getSidebarArray = (label: string) =>
      $(`.spaceit_pad:contains("${label}")`)
        .find('a')
        .map((_, el) => $(el).text().trim())
        .get();

    const info = {
      id:
        $('meta[property="og:url"]')
          .attr('content')
          ?.match(/\/anime\/(\d+)/)?.[1] || null,
      isAdult: false,
      bannerImage: null,
      color: null,
      country: null,
      image: $('div[style*="text-align: center"] img.lazyload').attr('data-src') || null,
      title: {
        english: $('#contentWrapper .title-english').text().trim() || null,
        romaji: $('#contentWrapper .title-name').text().trim() || null,
        native:
          $('.spaceit_pad:has(.dark_text:contains("Japanese:"))').clone().children().remove().end().text().trim() || null,
      },
      trailer: $('div.video-promotion > a ').attr('href') || null,
      format: getSidebar('Type:') || null,
      episodes: parseInt(getSidebar('Episodes:') || '0', 10) || null,
      status: getSidebar('Status:'),
      synonyms:
        getSidebar('Synonyms:')
          ?.split(',')
          .map(s => s.trim()) || [],
      year: parseInt(getSidebar('Premiered:')?.split(' ')[1] || '', 10) || null,
      duration: parseInt(getSidebar('Duration:') || '0', 10) || null,
      score: parseFloat($('.score-label').text().trim()) || null,
      genres: getSidebarArray('Genres:'),
      synopsis: $('[itemprop="description"]').text().trim() || null,
      season: getSidebar('Premiered:')?.split(' ')[0] || null,
      releaseDate: getSidebar('Aired:')?.split(' to ')[0]?.trim() || null,
      endDate: getSidebar('Aired:')?.split(' to ')[1]?.trim() || null,
      studio: getSidebarArray('Studios:')[0] || null,
      producers: getSidebarArray('Producers:'),
    };

    return { data: info };
  }
}
export { MyAnimeList };
