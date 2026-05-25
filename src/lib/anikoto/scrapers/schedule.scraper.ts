import * as cheerio from 'cheerio';
import { fetchPage } from '../fetcher.js';
import type { ScheduleDay, AnimeCard } from '../types.js';

export async function scrapeSchedule(): Promise<ScheduleDay[]> {
  const $ = await fetchPage('/home');

  const days: ScheduleDay[] = [];

  $('#schedule-block .schedule-day, .schedule-block .sch-item-head').each((_: number, dayEl: cheerio.AnyNode) => {
    const $day = $(dayEl);
    const dayName = $day.find('.day-name, h3').text().trim();
    if (!dayName) return;

    const animes: AnimeCard[] = [];
    $day
      .next('.schedule-list, .schedule-items')
      .find('.item, .flw-item')
      .each((__: number, el: cheerio.AnyNode) => {
        const $el = $(el);
        const href = $el.find('a').attr('href') ?? '';
        const slug = href
          .replace(/^https?:\/\/[^/]+/, '')
          .replace(/^\/watch\//, '')
          .replace(/\/ep-\d+$/, '')
          .replace(/\/$/, '');
        animes.push({
          id: $el.find('[data-tip]').attr('data-tip') ?? slug,
          slug,
          title: $el.find('.name, .d-title').text().trim(),
          image: $el.find('img').attr('src') ?? '',
          href: `/api/anikoto/anime/${slug}`,
          type: $el.find('.type').text().trim() || undefined,
        });
      });

    days.push({ day: dayName, animes });
  });

  return days;
}
