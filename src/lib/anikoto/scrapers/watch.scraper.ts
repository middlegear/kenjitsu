import * as cheerio from 'cheerio';
import { fetchJson } from '../fetcher.js';
import { scrapeAnimeEpisodes } from './anime.scraper.js';
import type { Episode } from '../types.js';
import { extractStreamUrl } from '../extractors.js';

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
  tracks?: Array<{
    file: string;
    label?: string;
    kind?: string;
    default?: boolean;
    proxyUrl?: string;
  }>;
}

export interface WatchData {
  episode: Episode;
  servers: VideoServer[];
  sources: VideoSource[];
}

export async function scrapeWatch(slug: string, epNum: string): Promise<WatchData> {
  const { episodes } = await scrapeAnimeEpisodes(slug);
  const ep = episodes.find(e => e.number === epNum);

  if (!ep || !ep.dataIds) {
    throw new Error(`Episode ${epNum} not found or has no data-ids for slug ${slug}`);
  }

  const listData = await fetchJson<{ status: boolean; result: string }>(
    `/ajax/server/list?servers=${ep.dataIds}`,
  );

  if (!listData.status || !listData.result) {
    throw new Error('Failed to fetch server list from AJAX');
  }

  const $ = cheerio.load(listData.result);
  const servers: VideoServer[] = [];

  $('.server, li').each((_: number, el: cheerio.AnyNode) => {
    const $el = $(el);
    const linkId = $el.attr('data-link-id');
    if (!linkId) return;

    const $typeContainer = $el.closest('.type');
    const typeLabel = $typeContainer.find('label, .name').text().trim().toLowerCase();
    const serverName = $el.text().trim();

    servers.push({
      id: linkId,
      name: serverName,
      type: typeLabel || 'sub',
    });
  });

  const sources: VideoSource[] = [];

  await Promise.all(
    servers.map(async server => {
      try {
        const sourceData = await fetchJson<{ status: boolean; result: { url: string } }>(
          `/ajax/server?get=${server.id}`,
        );
        if (sourceData.status && sourceData.result?.url) {
          const embedUrl = sourceData.result.url;
          const extracted = await extractStreamUrl(embedUrl);

          sources.push({
            server: server.name,
            type: server.type,
            url: embedUrl,
            m3u8: extracted?.m3u8 ?? null,
            referer: extracted?.referer,
            proxyUrl: extracted
              ? `/api/anikoto/proxy?url=${encodeURIComponent(extracted.m3u8)}&referer=${encodeURIComponent(extracted.referer)}`
              : null,
            tracks:
              extracted?.tracks?.map(t => ({
                ...t,
                proxyUrl: extracted.referer
                  ? `/api/anikoto/proxy?url=${encodeURIComponent(t.file)}&referer=${encodeURIComponent(extracted.referer)}`
                  : undefined,
              })) || [],
          });
        }
      } catch (err) {
        console.error(`Failed to fetch source for server ${server.id}`, err);
      }
    }),
  );

  return { episode: ep, servers, sources };
}
