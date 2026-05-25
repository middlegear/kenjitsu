import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { fetchPage } from '../fetcher.js';
import type {
  HomeData,
  SpotlightAnime,
  LatestEpisodeItem,
  TopTableItem,
  TopAnimeItem,
  EpisodeStatus,
} from '../types.js';

function parseEpisodeStatus($el: cheerio.Cheerio<AnyNode>): EpisodeStatus {
  const status: EpisodeStatus = {};
  const subText = $el.find('.ep-status.sub span').first().text().trim();
  const dubText = $el.find('.ep-status.dub span').first().text().trim();
  const totalText = $el.find('.ep-status.total span').first().text().trim();
  if (subText) status.sub = parseInt(subText, 10) || null;
  if (dubText) status.dub = parseInt(dubText, 10) || null;
  if (totalText) status.total = parseInt(totalText, 10) || null;
  return status;
}

function parseSpotlight($: cheerio.CheerioAPI): SpotlightAnime[] {
  const results: SpotlightAnime[] = [];
  $('#hotest .swiper-slide.item').each((_: number, el: AnyNode) => {
    const $el = $(el);
    const bgStyle = $el.find('.image div').attr('style') ?? '';
    const imageMatch = bgStyle.match(/url\(['"']?(.+?)['"']?\)/);

    const watchUrl = $el.find('.actions a.play').attr('href') ?? '';
    const slug = watchUrl
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/watch\//, '')
      .replace(/\/ep-\d+$/, '')
      .replace(/\/$/, '');

    results.push({
      slug,
      title: $el.find('.title').text().trim(),
      titleJp: $el.find('.title').attr('data-jp')?.trim(),
      rating: $el.find('.meta .rating').text().trim() || undefined,
      quality: $el.find('.meta .quality').text().trim() || undefined,
      hasDub: $el.find('.meta .dub').length > 0,
      hasSub: $el.find('.meta .sub').length > 0,
      date: $el.find('.meta .date').text().trim() || undefined,
      synopsis: $el.find('.synopsis').text().trim() || undefined,
      watchUrl,
      href: `/api/anikoto/anime/${slug}`,
      image: imageMatch?.[1] ?? '',
    });
  });
  return results;
}

function parseLatestEpisodes($: cheerio.CheerioAPI): LatestEpisodeItem[] {
  const results: LatestEpisodeItem[] = [];
  $('#recent-update .ani.items .item').each((_: number, el: AnyNode) => {
    const $el = $(el);
    const $poster = $el.find('.ani.poster');
    const $link = $poster.find('a');
    const href = $link.attr('href') ?? '';
    const watchHref = href;
    const slug = href
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/watch\//, '')
      .replace(/\/ep-\d+$/, '');

    results.push({
      id: $poster.attr('data-tip') ?? slug,
      slug,
      title: $el.find('.info a.name').text().trim(),
      titleJp: $el.find('.info a.name').attr('data-jp')?.trim(),
      image: $poster.find('img').attr('src') ?? '',
      href: `/api/anikoto/anime/${slug}`,
      watchHref,
      type: $poster.find('.meta .right').text().trim() || undefined,
      episodes: parseEpisodeStatus($poster),
    });
  });
  return results;
}

function parseTopTable($: cheerio.CheerioAPI, section: string): TopTableItem[] {
  const results: TopTableItem[] = [];
  $(`section[data-name="${section}"] .scaff.items .item`).each((_: number, el: AnyNode) => {
    const $el = $(el);
    const $poster = $el.find('.poster');
    const href = $el.attr('href') ?? '';
    const slug = href
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/watch\//, '')
      .replace(/\/ep-\d+$/, '');

    results.push({
      id: $poster.attr('data-tip') ?? slug,
      slug,
      title: $el.find('.name').text().trim(),
      titleJp: $el.find('.name').attr('data-jp')?.trim(),
      image: $poster.find('img').attr('src') ?? '',
      href: `/api/anikoto/anime/${slug}`,
      type: $el.find('.meta .dot:not(.ep-wrap)').first().text().trim() || undefined,
      episodes: parseEpisodeStatus($el),
      date: $el.find('.meta .dot:last-child').text().trim() || undefined,
    });
  });
  return results;
}

function parseTopAnime($: cheerio.CheerioAPI, tabName: string): TopAnimeItem[] {
  const results: TopAnimeItem[] = [];
  $(`#top-anime .tab-content[data-name="${tabName}"] .scaff.items .item`).each((_: number, el: AnyNode) => {
    const $el = $(el);
    const rankClass = [...($el.attr('class')?.split(' ') ?? [])].find(c => c.startsWith('rank'));
    const rank = rankClass ? parseInt(rankClass.replace('rank', ''), 10) : 0;
    const $poster = $el.find('.poster');
    const href = $el.attr('href') ?? '';
    const slug = href
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/watch\//, '')
      .replace(/\/ep-\d+$/, '');

    results.push({
      rank,
      id: $poster.attr('data-tip') ?? slug,
      slug,
      title: $el.find('.name').text().trim(),
      titleJp: $el.find('.name').attr('data-jp')?.trim(),
      image: $poster.find('img').attr('src') ?? '',
      href: `/api/anikoto/anime/${slug}`,
      type: $el.find('.meta .dot:not(.ep-wrap)').first().text().trim() || undefined,
      episodes: parseEpisodeStatus($el),
    });
  });
  return results;
}

export async function scrapeHome(): Promise<HomeData> {
  const $ = await fetchPage('/home');

  return {
    spotlight: parseSpotlight($),
    latestEpisodes: parseLatestEpisodes($),
    newRelease: parseTopTable($, 'new-release'),
    newAdded: parseTopTable($, 'new-added'),
    justCompleted: parseTopTable($, 'completed'),
    topDay: parseTopAnime($, 'day'),
    topWeek: parseTopAnime($, 'week'),
    topMonth: parseTopAnime($, 'month'),
  };
}
