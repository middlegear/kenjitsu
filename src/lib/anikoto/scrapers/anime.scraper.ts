import * as cheerio from 'cheerio';
import { fetchPage, fetchJson } from '../fetcher.js';
import type { AnimeDetail, AnimeEpisodes, Episode } from '../types.js';
import { ANIKOTO_BASE_URL } from '../constants.js';

// ─── Anime Detail ────────────────────────────────────────────────────────────

export async function scrapeAnimeDetail(slug: string): Promise<AnimeDetail> {
  const $ = await fetchPage(`/watch/${slug}`);

  const $main = $('#watch-main');
  const animeId = $main.attr('data-id') ?? '';
  const animeUrl = $main.attr('data-url') ?? '';

  const $binfo = $('.binfo');
  const $poster = $binfo.find('.poster img');
  const $info = $binfo.find('.info');

  const altRaw = $info.find('.names').text().trim();
  const alternativeTitles = altRaw
    ? altRaw
        .split(/[;,]/)
        .map((s: string) => s.trim())
        .filter(Boolean)
    : [];

  const genres: string[] = [];
  $info.find('.bmeta .meta div').each((_: number, el: cheerio.AnyNode) => {
    const $el = $(el);
    const label = $el.clone().children().remove().end().text().trim();
    if (label.toLowerCase().startsWith('genre')) {
      $el.find('a').each((__: number, a: cheerio.AnyNode) => {
        genres.push($(a).text().trim());
      });
    }
  });

  const studios: string[] = [];
  const producers: string[] = [];
  $info.find('.bmeta .meta div').each((_: number, el: cheerio.AnyNode) => {
    const $el = $(el);
    const label = $el.clone().children().remove().end().text().trim().toLowerCase();
    if (label.startsWith('studio')) {
      $el.find('a').each((__: number, a: cheerio.AnyNode) => {
        studios.push($(a).text().trim());
      });
    }
    if (label.startsWith('producer')) {
      $el.find('a').each((__: number, a: cheerio.AnyNode) => {
        producers.push($(a).text().trim());
      });
    }
  });

  function getMeta(labelPrefix: string): string | undefined {
    let result: string | undefined;
    $info.find('.bmeta .meta div').each((_: number, el: cheerio.AnyNode) => {
      const $el = $(el);
      const labelText = $el.clone().children().remove().end().text().trim();
      if (labelText.toLowerCase().startsWith(labelPrefix.toLowerCase())) {
        result = $el.find('span, a').first().text().trim() || $el.find('span').text().trim();
      }
    });
    return result || undefined;
  }

  const malScoreRaw = $info
    .find('.bmeta .meta div')
    .filter((_: number, el: cheerio.AnyNode) => {
      return $(el).clone().children().remove().end().text().trim().toLowerCase().startsWith('mal');
    })
    .find('span')
    .text()
    .trim();

  const epCountRaw = $info
    .find('.bmeta .meta div')
    .filter((_: number, el: cheerio.AnyNode) => {
      return $(el).clone().children().remove().end().text().trim().toLowerCase().startsWith('episode');
    })
    .find('span')
    .text()
    .trim();

  const episodes = await scrapeAnimeEpisodes(slug);

  return {
    id: animeId,
    slug,
    title: $info.find('h1.title').text().trim(),
    titleJp: $info.find('h1.title').attr('data-jp')?.trim(),
    alternativeTitles,
    image: $poster.attr('src') ?? '',
    rating: $info.find('.meta.icons .rating').text().trim() || undefined,
    quality: $info.find('.meta.icons .quality').text().trim() || undefined,
    hasDub: $info.find('.meta.icons .dub').length > 0,
    hasSub: $info.find('.meta.icons .sub').length > 0,
    synopsis: $info.find('.synopsis .content').text().trim() || $info.find('.synopsis').text().trim() || undefined,
    type: getMeta('type'),
    premiered: getMeta('premiered'),
    aired: getMeta('aired'),
    status: getMeta('status'),
    genres,
    malScore: malScoreRaw ? parseFloat(malScoreRaw) : undefined,
    duration: getMeta('duration'),
    episodeCount: epCountRaw ? parseInt(epCountRaw, 10) : undefined,
    studios,
    producers,
    watchUrl: animeUrl || `${ANIKOTO_BASE_URL}/watch/${slug}`,
    episodes,
  };
}

// ─── Episode List ─────────────────────────────────────────────────────────────

export async function scrapeAnimeEpisodes(
  slug: string,
  startEpisode?: number,
  endEpisode?: number,
): Promise<AnimeEpisodes> {
  const $ = await fetchPage(`/watch/${slug}`);
  const animeId = $('#watch-main').attr('data-id') ?? '';

  if (animeId && $('#w-episodes a').length === 0) {
    try {
      const data = await fetchJson<{ status: boolean; result: string }>(`/ajax/episode/list/${animeId}`);
      if (data && data.result) {
        const ajaxDoc = cheerio.load(data.result);
        $('#w-episodes').html(ajaxDoc.html());
      }
    } catch (err) {
      console.error('Failed to fetch episodes via AJAX:', err);
    }
  }

  const allEpisodes: Episode[] = [];

  $('#w-episodes ul.ep-range li a, #w-episodes a[href], #w-episodes a[data-num]').each(
    (_: number, el: cheerio.AnyNode) => {
      const $el = $(el);
      const href = $el.attr('href') ?? '';
      if (!href.includes('/watch/') && !$el.attr('data-num')) return;

      const epNum =
        $el.attr('data-num') ||
        $el.find('.number, .d-title, span').first().text().trim() ||
        href.split('/ep-')[1] ||
        '';

      allEpisodes.push({
        number: epNum || String(allEpisodes.length + 1),
        title: $el.attr('title')?.trim() || undefined,
        href,
        id: $el.attr('data-id') ?? undefined,
        dataIds: $el.attr('data-ids') ?? $el.attr('data-id') ?? undefined,
        hasDub:
          $el.find('.ep-status.dub').length > 0 ||
          $el.text().toLowerCase().includes('dub') ||
          $el.attr('data-dub') === '1',
        hasSub:
          $el.find('.ep-status.sub').length > 0 ||
          $el.text().toLowerCase().includes('sub') ||
          $el.attr('data-sub') === '1',
      });
    },
  );

  let filteredEpisodes = allEpisodes;

  if (startEpisode !== undefined && endEpisode !== undefined) {
    filteredEpisodes = allEpisodes.filter(ep => {
      const num = parseInt(ep.number, 10);
      return num >= startEpisode && num <= endEpisode;
    });
  }

  return { animeId, slug, episodes: filteredEpisodes };
}
