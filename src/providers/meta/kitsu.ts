import type { ClientOptions } from '../../config/client.js';
import type { IResponse } from '../../types/base.js';
import type { IMetaAnime, IMetaAnimeEpisode, IProviderId, IRelatedAnimeData } from '../../types/meta/meta-anime.js';
import { BaseClass } from '../models/base.js';

/**
 * Client for interacting with the Kitsu.io anime API.
 *
 * Provides methods to search for anime, fetch detailed information,
 * retrieve episode lists, resolve AniList ↔ Kitsu mappings, and
 * traverse franchise timelines (prequels / sequels).
 *
 */
class Kitsu extends BaseClass {
  private readonly baseUrl: string;

  constructor(baseUrl: string = 'https://kitsu.io/api/edge', options: ClientOptions = { browser: 'okhttp4' }) {
    super(options);
    this.baseUrl = baseUrl;
  }

  /**
   * Searches for anime by free-text query.
   *
   * @param query - Search string (title, synonym, etc.).
   * @returns A response containing an array of matching {@link IMetaAnime}
   *          objects, or an empty array on failure.
   */
  async search(query: string): Promise<IResponse<IMetaAnime[] | []>> {
    try {
      const response = await this.client.fetch(`${this.baseUrl}/anime?filter[text]=${encodeURIComponent(query)}`, {
        method: 'GET',
      });

      if (!response.ok) {
        return {
          error: response.statusText,
          data: [],
          status: response.status,
        };
      }

      const result = await response.json();

      const data: IMetaAnime[] = result.data.map((item: any) => {
        const a = item.attributes;

        return {
          id: item.id?.toString() ?? null,

          isAdult: a.nsfw ?? false,

          image:
            a.posterImage?.original ??
            a.posterImage?.large ??
            a.posterImage?.medium ??
            a.posterImage?.small ??
            a.posterImage?.tiny ??
            null,

          bannerImage: a.coverImage?.original ?? a.coverImage?.large ?? a.coverImage?.small ?? a.coverImage?.tiny ?? null,

          color: null,

          title: {
            romaji: a.titles?.en_jp ?? a.canonicalTitle ?? null,
            english: a.titles?.en ?? null,
            native: a.titles?.ja_jp ?? null,
          },

          trailer: a.youtubeVideoId ? `https://www.youtube.com/watch?v=${a.youtubeVideoId}` : null,

          format: a.showType ?? a.subtype ?? null,

          status: a.status ?? null,

          synonyms: a.abbreviatedTitles ?? [],

          country: null,

          year: a.startDate ? new Date(a.startDate).getFullYear() : null,

          duration: a.episodeLength ?? null,

          score: a.averageRating ? Number(a.averageRating) : null,

          genres: [],

          episodes: a.episodeCount ?? null,

          synopsis: a.synopsis ?? a.description ?? null,

          season: null,

          releaseDate: a.startDate ?? null,

          endDate: a.endDate ?? null,

          studio: null,

          producers: [],
        };
      });

      return {
        data,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown Err',
        data: [],
        status: 500,
      };
    }
  }

  /**
   * Looks up anime by its exact Kitsu slug.
   *
   * @param query - The slug string (e.g. `'cowboy-bebop'`).
   * @returns A response containing matching {@link IMetaAnime} entries,
   *          or an empty array on failure.
   */
  async searchSlug(query: string): Promise<IResponse<IMetaAnime[] | []>> {
    try {
      const response = await this.client.fetch(`${this.baseUrl}/anime?filter[slug]=${encodeURIComponent(query)}`, {
        method: 'GET',
      });

      if (!response.ok) {
        return {
          error: response.statusText,
          data: [],
          status: response.status,
        };
      }

      const result = await response.json();

      const data: IMetaAnime[] = result.data.map((item: any) => {
        const a = item.attributes;

        return {
          id: item.id?.toString() ?? null,

          isAdult: a.nsfw ?? false,

          image:
            a.posterImage?.original ??
            a.posterImage?.large ??
            a.posterImage?.medium ??
            a.posterImage?.small ??
            a.posterImage?.tiny ??
            null,

          bannerImage: a.coverImage?.original ?? a.coverImage?.large ?? a.coverImage?.small ?? a.coverImage?.tiny ?? null,

          color: null,

          title: {
            romaji: a.titles?.en_jp ?? a.canonicalTitle ?? null,
            english: a.titles?.en ?? null,
            native: a.titles?.ja_jp ?? null,
          },

          trailer: a.youtubeVideoId ? `https://www.youtube.com/watch?v=${a.youtubeVideoId}` : null,

          format: a.showType ?? a.subtype ?? null,

          status: a.status ?? null,

          synonyms: a.abbreviatedTitles ?? [],

          country: null,

          year: a.startDate ? new Date(a.startDate).getFullYear() : null,

          duration: a.episodeLength ?? null,

          score: a.averageRating ? Number(a.averageRating) : null,

          genres: [],

          episodes: a.episodeCount ?? null,

          synopsis: a.synopsis ?? a.description ?? null,

          season: null,

          releaseDate: a.startDate ?? null,

          endDate: a.endDate ?? null,

          studio: null,

          producers: [],
        };
      });

      return {
        data,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown Err',
        data: [],
        status: 500,
      };
    }
  }

  /**
   * Fetches full metadata for a single anime by its Kitsu ID.
   *
   * @param id - Numeric Kitsu anime ID.
   * @returns A response containing the {@link IKitsuAnime} object,
   *          or `null` on failure.
   */
  async fetchInfo(id: number): Promise<IResponse<IMetaAnime | null>> {
    try {
      const response = await this.client.fetch(`${this.baseUrl}/anime/${id}`, {
        method: 'GET',
      });

      if (!response.ok) {
        return {
          data: null,
          error: response.statusText,
          status: response.status,
        };
      }

      const result = await response.json();
      const a = result.data.attributes;

      const data: IMetaAnime = {
        id: result.data.id?.toString() ?? null,

        isAdult: a.nsfw ?? false,

        image:
          a.posterImage?.original ??
          a.posterImage?.large ??
          a.posterImage?.medium ??
          a.posterImage?.small ??
          a.posterImage?.tiny ??
          null,

        bannerImage: a.coverImage?.original ?? a.coverImage?.large ?? a.coverImage?.small ?? a.coverImage?.tiny ?? null,

        color: null,

        title: {
          romaji: a.titles?.en_jp ?? a.canonicalTitle ?? null,
          english: a.titles?.en ?? null,
          native: a.titles?.ja_jp ?? null,
        },

        trailer: a.youtubeVideoId ? `https://www.youtube.com/watch?v=${a.youtubeVideoId}` : null,

        format: a.showType ?? a.subtype ?? null,

        status: a.status ?? null,

        synonyms: a.abbreviatedTitles ?? [],

        country: null,

        year: a.startDate ? new Date(a.startDate).getFullYear() : null,

        duration: a.episodeLength ?? null,

        score: a.averageRating ? Number(a.averageRating) : null,

        genres: [],

        episodes: a.episodeCount ?? null,

        synopsis: a.synopsis ?? a.description ?? null,

        season: null,

        releaseDate: a.startDate ?? null,

        endDate: a.endDate ?? null,

        studio: null,

        producers: [],
      };

      return {
        data,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown Err',
        data: null,
        status: 500,
      };
    }
  }

  /**
   * Retrieves the episode list for an anime from kitsu & Anizip
   * @param id - Numeric Kitsu anime ID.
   * @returns A response containing an array of episode objects.
   */
  async fetchEpisodes(id: number): Promise<IResponse<IMetaAnimeEpisode[] | []>> {
    if (!id) return { error: `Missing required param: id`, data: [] };

    const anizipResult = await this.fetchAnizipEpisodes(id);

    if (anizipResult.data && anizipResult.data.length > 0) {
      return anizipResult;
    }
    return await this.fetchKitsuEpisodes(id);
  }
  /**
   * Resolves an AniList anime ID to its corresponding Kitsu entry.
   *
   * Queries Kitsu's mappings endpoint with `externalSite=anilist/anime`.
   *
   * @param id - anime ID.
   * @param externalSite - database to use eg (anilist/myanimelist). Defaults to anilist
   * @returns A response containing a lightweight mapping object
   */
  async fetchMapping(id: number, externalSite: string = 'anilist'): Promise<IResponse<IProviderId | null>> {
    try {
      const response = await this.client.fetch(
        `${this.baseUrl}/mappings?filter[externalSite]=${externalSite}/anime&filter[externalId]=${id}&include=item`,
        { method: 'GET' },
      );
      if (!response.ok) {
        return {
          error: response.statusText,
          data: null,
          status: response.status,
        };
      }

      const result = await response.json();

      const kitsuId = result.data?.[0]?.relationships?.item?.data?.id;

      if (!kitsuId) {
        return {
          data: null,
          error: this.formatHttpError(404),
          status: 404,
        };
      }
      const anime = result.included?.find((item: any) => item.type === 'anime' && item.id === kitsuId);

      return {
        data: {
          id: kitsuId,
          provider: 'Kitsu',
          name: anime?.attributes?.canonicalTitle,
          romaji: anime?.attributes?.titles?.en_jp ?? anime?.attributes?.canonicalTitle,
          score: null,
          source: null,
        },
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown Err',
        data: null,
        status: 500,
      };
    }
  }

  /**
   * Fetches anime titles related to a specific Kitsu anime ID — sequels,
   * prequels, spin-offs, adaptations.
   *
   *
   *
   * @param mediaId - The unique Kitsu anime ID (required).
   * @returns A response containing an array of {@link IRelatedAnimeData}
   *          entries sorted by timeline order.
   */
  async fetchRelatedAnime(mediaId: string): Promise<IResponse<IRelatedAnimeData[] | []>> {
    if (!mediaId) {
      return {
        data: [],
        error: 'Missing a required parameter: mediaId',
        status: 400,
      };
    }

    try {
      const response = await this.client.fetch(
        `${this.baseUrl}/anime/${mediaId}/media-relationships?include=destination&page[limit]=20`,
        {
          method: 'GET',
        },
      );

      if (!response.ok) {
        return {
          error: response.statusText || 'Server returned an empty response',
          data: [],
          status: response.status,
        };
      }

      const result = await response.json();

      const relationships = result.data ?? [];
      const included = result.included ?? [];

      const findIncluded = (type: string, id: string) => included.find((inc: any) => inc.type === type && inc.id === id);

      const res: IRelatedAnimeData[] = relationships
        .filter(
          (rel: any) =>
            rel.relationships?.destination?.data?.type === 'anime' && this.TIMELINE_ROLES.has(rel.attributes?.role),
        )
        .map((rel: any) => {
          const dest = rel.relationships.destination.data;
          const node = findIncluded(dest.type, dest.id);

          return node ? this.mapKitsuNode(node, rel.attributes.role) : null;
        })
        .filter((entry: any): entry is IRelatedAnimeData => entry !== null);

      return {
        data: this.sortByTimeline(res),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown Error',
        data: [],
        status: 500,
      };
    }
  }

  /**
   * Climbs the relation chain using only the `prequel` role, starting from
   * `mediaId`, until it finds a node with no further prequel
   *
   *
   * @param mediaId - Kitsu anime ID to start climbing from.
   * @returns A response containing the chronologically sorted franchise
   *          timeline, with the earliest entry marked `relationType: 'ROOT'`.
   */
  async fetchParentSeries(mediaId: string): Promise<IResponse<IRelatedAnimeData[] | []>> {
    const visitedIds = new Set<string>();

    try {
      let currentId = mediaId;
      let rootNode: any = null;

      while (currentId && !visitedIds.has(currentId)) {
        visitedIds.add(currentId);

        const response = await this.client.fetch(
          `${this.baseUrl}/anime/${currentId}/media-relationships?include=destination&page[limit]=20`,
          {
            method: 'GET',
          },
        );

        if (!response.ok) {
          return {
            error: response.statusText || 'Server returned an empty response',
            data: [],
            status: response.status,
          };
        }

        const result = await response.json();

        const relationships = result.data ?? [];
        const included = result.included ?? [];

        const nodeResponse = await this.client.fetch(`${this.baseUrl}/anime/${currentId}`, {
          method: 'GET',
        });

        if (!nodeResponse.ok) {
          return {
            error: nodeResponse.statusText || 'Server returned an empty response',
            data: [],
            status: nodeResponse.status,
          };
        }

        const nodeResult = await nodeResponse.json();
        const currentNode = nodeResult.data;

        rootNode = currentNode;

        const findIncluded = (type: string, id: string) => included.find((inc: any) => inc.type === type && inc.id === id);

        const prequel = relationships.find(
          (rel: any) => rel.attributes?.role === 'prequel' && rel.relationships?.destination?.data?.type === 'anime',
        );

        if (!prequel) {
          break;
        }

        const destination = prequel.relationships.destination.data;
        const prequelNode = findIncluded(destination.type, destination.id);

        if (!prequelNode) {
          break;
        }

        currentId = prequelNode.id;
      }

      if (!rootNode) {
        return {
          error: 'Could not resolve a root series',
          data: [],
          status: 404,
        };
      }

      const timelineNodes = new Map<
        string,
        {
          relationType: string;
          node: any;
        }
      >();

      const queue: {
        node: any;
        relationType: string;
      }[] = [
        {
          node: rootNode,
          relationType: '',
        },
      ];
      const timelineVisited = new Set<string>();

      while (queue.length > 0) {
        const current = queue.shift()!;

        const nodeId = current.node.id;

        if (!nodeId || timelineVisited.has(nodeId)) {
          continue;
        }

        timelineVisited.add(nodeId);

        timelineNodes.set(nodeId, {
          relationType: current.relationType,
          node: current.node,
        });

        const response = await this.client.fetch(
          `${this.baseUrl}/anime/${nodeId}/media-relationships?include=destination&page[limit]=20`,
          {
            method: 'GET',
          },
        );

        if (!response.ok) {
          continue;
        }

        const result = await response.json();

        const relationships = result.data ?? [];
        const included = result.included ?? [];

        const findIncluded = (type: string, id: string) => included.find((inc: any) => inc.type === type && inc.id === id);

        for (const rel of relationships) {
          const role = rel.attributes?.role;

          if (!this.TIMELINE_ROLES.has(role)) {
            continue;
          }

          const destination = rel.relationships?.destination?.data;

          if (!destination || destination.type !== 'anime') {
            continue;
          }

          const node = findIncluded(destination.type, destination.id);

          if (!node || timelineVisited.has(node.id)) {
            continue;
          }

          queue.push({
            node,
            relationType: role,
          });
        }
      }

      const timeline = this.sortByTimeline(
        [...timelineNodes.values()].map(({ node, relationType }) => this.mapKitsuNode(node, relationType)),
      );

      const tvIndex = timeline.findIndex(item => item.format === 'TV');

      if (tvIndex !== -1) {
        timeline[tvIndex] = {
          ...timeline[tvIndex],
          relationType: 'ROOT',
        };
      }

      return {
        data: timeline,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown Error',
        data: [],
        status: 500,
      };
    }
  }
  /**
   * Retrieves the episode list for an anime from kitsu.(unreliable missing lists)
   * @param id - Numeric Kitsu anime ID.
   * @returns A response containing an array of episode objects.
   */
  private async fetchKitsuEpisodes(id: number): Promise<IResponse<IMetaAnimeEpisode[] | []>> {
    try {
      const response = await this.client.fetch(`${this.baseUrl}/anime/${id}/episodes`, {
        method: 'GET',
      });

      if (!response.ok) {
        return {
          error: response.statusText,
          data: [],
          status: response.status,
        };
      }

      const result = await response.json();
      const todayStr = new Date().toISOString().slice(0, 10);

      const data: IMetaAnimeEpisode[] = (result.data ?? [])
        .map((item: any) => {
          const a = item.attributes ?? {};
          const rawAirDate = a.airdate ?? null;

          return {
            airDate: rawAirDate,
            title: a.titles?.en ?? a.canonicalTitle ?? a.titles?.en_jp ?? a.titles?.ja_jp ?? null,
            thumbnail:
              a.thumbnail?.original ??
              a.thumbnail?.large ??
              a.thumbnail?.medium ??
              a.thumbnail?.small ??
              a.thumbnail?.tiny ??
              null,
            isFiller: null,
            episodeNumber: a.number ?? null,
            summary: a.synopsis ?? a.description ?? null,
            aired: rawAirDate ? rawAirDate.slice(0, 10) <= todayStr : false,
          };
        })
        .filter((episode: { aired: boolean }) => episode.aired === true);

      return {
        data,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown Err',
        data: [],
        status: 500,
      };
    }
  }

  /** Roles considered part of a franchise timeline. */
  private readonly TIMELINE_ROLES = new Set(['prequel', 'sequel']);

  /**
   * Maps a raw Kitsu anime node (from `included` or a direct fetch)
   * into the standardised {@link IRelatedAnimeData} shape.
   *
   * @param node - Raw Kitsu resource object.
   * @param relationType - Relation role (`prequel`, `sequel`, `ROOT`, etc.).
   * @returns Normalised related-anime entry.
   */
  private mapKitsuNode(node: any, relationType: string): IRelatedAnimeData {
    const attrs = node.attributes ?? {};
    const titles = attrs.titles ?? {};

    return {
      id: node.id?.toString() ?? null,

      relationType,

      title: {
        romaji: attrs.canonicalTitle ?? titles.en_jp ?? titles.ja_jp ?? null,
        english: titles.en ?? null,
        native: titles.ja_jp ?? null,
      },

      type: node.type ?? null,
      format: attrs.subtype ?? null,

      synonyms: attrs.abbreviatedTitles ?? [],

      year: attrs.startDate ? Number(attrs.startDate.slice(0, 4)) : null,

      startDate: attrs.startDate ?? null,
      endDate: attrs.endDate ?? null,

      score: attrs.averageRating ? Number(attrs.averageRating) : null,

      image:
        attrs.posterImage?.large ??
        attrs.posterImage?.original ??
        attrs.posterImage?.medium ??
        attrs.posterImage?.small ??
        attrs.posterImage?.tiny ??
        null,

      bannerImage:
        attrs.coverImage?.large ?? attrs.coverImage?.original ?? attrs.coverImage?.small ?? attrs.coverImage?.tiny ?? null,

      color: null,
      country: null,
    };
  }

  /**
   * Sorts entries chronologically by startDate (ascending), falling back to
   * endDate when startDate is missing. Entries with no date at all are
   * pushed to the end, after everything with a known date.
   *
   * @param entries - Array of related-anime entries to sort.
   * @returns A new array sorted by timeline order.
   */
  private sortByTimeline(entries: IRelatedAnimeData[]): IRelatedAnimeData[] {
    return [...entries].sort((a, b) => {
      const aDate = a.startDate ?? a.endDate;
      const bDate = b.startDate ?? b.endDate;

      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;

      return aDate.localeCompare(bDate);
    });
  }
  private async fetchAnizipEpisodes(id: number): Promise<IResponse<IMetaAnimeEpisode[] | []>> {
    if (!id) return { error: `Missing required param: id`, data: [] };

    try {
      const kitsuResponse = await this.client.fetch(`https://api.ani.zip/mappings?kitsu_id=${id}`, { method: 'GET' });

      if (kitsuResponse.ok) {
        const kitsuResult = await kitsuResponse.json();
        if (kitsuResult.mappings?.type?.toLowerCase() === 'movie') {
          return { data: [] };
        }
        const kitsuEpisodes = this.formatAnizipData(kitsuResult);

        if (kitsuEpisodes.episodes.length > 0) {
          return {
            data: kitsuEpisodes.episodes,
          };
        }
        const anilistId = kitsuResult.mappings?.anilist_id;
        if (anilistId) {
          const anilistResponse = await this.client.fetch(`https://api.ani.zip/mappings?anilist_id=${anilistId}`, {
            method: 'GET',
          });

          if (anilistResponse.ok) {
            const anilistResult = await anilistResponse.json();
            if (anilistResult.mappings?.type?.toLowerCase() === 'movie') {
              return { data: [] };
            }
            const anilistEpisodes = this.formatAnizipData(anilistResult);

            if (anilistEpisodes.episodes.length > 0) {
              return {
                data: anilistEpisodes.episodes,
              };
            }
          }
        }
      }

      return { data: [] };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        data: [],
        status: 500,
      };
    }
  }
  private formatAnizipData(data: any): { episodes: IMetaAnimeEpisode[] } {
    if (!data || !data.episodes) {
      return { episodes: [] };
    }

    if (data.type?.toLowerCase() === 'movie' || data.mappings?.type?.toLowerCase() === 'movie') {
      return { episodes: [] };
    }

    const episodeKeys = Object.keys(data.episodes);
    const todayStr = new Date().toISOString().slice(0, 10);

    const transformedEpisodes: IMetaAnimeEpisode[] = episodeKeys
      .filter(key => /^\d+$/.test(key))
      .map(key => {
        const episode = data.episodes[key];
        const rawAirDate = episode.airDate || episode.airdate;
        const englishTitle = episode.title?.en || episode.title?.['x-jat'] || null;
        const japaneseTitle = episode.title?.ja || null;
        const episodeNumber = Number(episode.episode || episode.episodeNumber) || null;

        return {
          airDate: rawAirDate || null,
          title: englishTitle || japaneseTitle || null,
          thumbnail: episode.image || null,
          isFiller: episode.filler ?? null,
          episodeNumber: episodeNumber,
          summary: episode.overview || episode.summary || null,
          aired: rawAirDate ? rawAirDate.slice(0, 10) <= todayStr : false,
        };
      })
      .filter(episode => episode.aired);

    return {
      episodes: transformedEpisodes,
    };
  }
}
export { Kitsu };
