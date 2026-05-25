import { fetchPage } from '../fetcher.js';
import type { AnimeCard, SearchResult, FilterResult, FilterParams, EpisodeStatus } from '../types.js';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

function parseCardEpisodeStatus($el: cheerio.Cheerio<AnyNode>): EpisodeStatus {
  const status: EpisodeStatus = {};
  const subText = $el.find('.ep-status.sub span').first().text().trim();
  const dubText = $el.find('.ep-status.dub span').first().text().trim();
  const totalText = $el.find('.ep-status.total span').first().text().trim();
  if (subText) status.sub = parseInt(subText, 10) || null;
  if (dubText) status.dub = parseInt(dubText, 10) || null;
  if (totalText) status.total = parseInt(totalText, 10) || null;
  return status;
}

function parseAnimeGrid($: cheerio.CheerioAPI, selector: string): AnimeCard[] {
  const results: AnimeCard[] = [];
  $(selector).each((_: number, el: AnyNode) => {
    const $el = $(el);
    const href = $el.attr('href') ?? $el.find('a').first().attr('href') ?? '';
    const slug = href
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/watch\//, '')
      .replace(/\/ep-\d+$/, '')
      .replace(/\/$/, '');
    const $poster = $el.find('.poster, [data-tip]').first();
    const id = $poster.attr('data-tip') ?? slug;

    const scoreText = $el.find('.score').text().replace(/[^0-9.]/g, '').trim();
    const epCountText = $el
      .find('.meta .dot')
      .filter((__: number, d: AnyNode) => /\d+ Eps/.test($(d).text()))
      .text()
      .replace(/[^0-9]/g, '')
      .trim();

    const yearText = $el.find('.meta .dot').last().text().trim();

    results.push({
      id,
      slug,
      title: $el.find('.name, .d-title').first().text().trim(),
      titleJp: $el.find('.name, .d-title').first().attr('data-jp')?.trim(),
      image: $el.find('img').first().attr('src') ?? '',
      href: `/api/anikoto/anime/${slug}`,
      type: $el.find('.meta .dot:not(.ep-wrap):not(.score)').first().text().trim() || undefined,
      episodes: parseCardEpisodeStatus($el),
      date: yearText || undefined,
      score: scoreText ? parseFloat(scoreText) : undefined,
      totalEpisodes: epCountText ? parseInt(epCountText, 10) : undefined,
    });
  });
  return results;
}

export async function scrapeSearch(keyword: string): Promise<SearchResult> {
  const $ = await fetchPage(`/filter?keyword=${encodeURIComponent(keyword)}`);
  const results = parseAnimeGrid(
    $,
    '.items.flw-wrap .film_list-wrap .flw-item, .film_list-wrap .flw-item, .ani.items .item, section .items .item',
  );
  return { results, keyword };
}

function buildFilterUrl(params: FilterParams): string {
  const qs = new URLSearchParams();
  if (params.keyword) qs.set('keyword', params.keyword);
  qs.set('type', '');
  if (params.genre?.length) params.genre.forEach(g => qs.append('genre[]', g));
  if (params.season?.length) params.season.forEach(s => qs.append('season[]', s));
  if (params.year?.length) params.year.forEach(y => qs.append('year[]', y));
  if (params.type?.length) params.type.forEach(t => qs.append('term_type[]', t));
  if (params.status?.length) params.status.forEach(s => qs.append('status[]', s));
  if (params.language?.length) params.language.forEach(l => qs.append('language[]', l));
  if (params.rating?.length) params.rating.forEach(r => qs.append('rating[]', r));
  if (params.sort) qs.set('sort', params.sort);
  if (params.page) qs.set('page', params.page);
  return `/filter?${qs.toString()}`;
}

export async function scrapeFilter(params: FilterParams): Promise<FilterResult> {
  const $ = await fetchPage(buildFilterUrl(params));

  const results = parseAnimeGrid(
    $,
    '.film_list-wrap .flw-item, .ani.items .item, .items.flw-wrap .flw-item, #list-items .item, .page-content .item',
  );

  const currentPage = parseInt(params.page ?? '1', 10);
  const hasNextPage = $('.paging .next:not(.disabled), .pagination .next:not(.disabled)').length > 0;

  return { results, currentPage, hasNextPage, params };
}

export async function scrapeListingPage(
  path: string,
  page = 1,
): Promise<{ results: AnimeCard[]; currentPage: number; hasNextPage: boolean }> {
  const url = page > 1 ? `${path}?page=${page}` : path;
  const $ = await fetchPage(url);

  const results = parseAnimeGrid($, '.film_list-wrap .flw-item, .ani.items .item, .items .item, .page-content .item');

  const hasNextPage = $('.paging .next:not(.disabled), .pagination .next:not(.disabled)').length > 0;

  return { results, currentPage: page, hasNextPage };
}
