import { getByAnilistId, upsertMapping } from '../db/queries.js';
import { TheMovieDatabase } from '../providers/main.js';
import type { IResponse } from '../types/base.js';
import type { IMetaAnime, IRelatedAnimeData } from '../types/meta/meta-anime.js';
import type {
  IMetaMovie,
  IMetaMovieEpisodes,
  IMetaMoviePaginated,
  IMetaTVInfo,
  IMovieInfo,
} from '../types/meta/meta-movie.js';
import type { AnimeInfoResolver } from './anime-resolver.js';

interface TitleSource {
  title: { english?: string | null; romaji?: string | null; native?: string | null };
  synonyms?: string[] | null;
}

interface SearchAnchor {
  title: string;
  year: number | null;
  format: string;
}
export interface IAnimeTVMetaInfo extends IMetaTVInfo {
  parsedEpisodes: IMetaMovieEpisodes[] | [];
  [x: string]: any;
}
export interface IAnimeMovieMetaInfo extends IMovieInfo {
  parsedEpisodes: IMetaMovieEpisodes[] | [];
  [x: string]: any;
}
class AnimeTmdb {
  constructor(private readonly resolver: AnimeInfoResolver) {}

  private readonly tmdb = new TheMovieDatabase();

  /* ------------------------------ Episode range ----------------------------- */

  /** Days a TMDB `mid_season`/`finale` marker may differ from AniList's end date and still be trusted as the cour cut. */
  private readonly COUR_BOUNDARY_TOLERANCE_DAYS = 2;

  /** Days AniList/Kitsu's start date may trail TMDB's first air date (timezone/region reporting differences). */
  private readonly START_BOUNDARY_TOLERANCE_DAYS = 2;

  /** Max days before the source start date that earlier episodes of the same season may air and still belong to the entry. */
  private readonly EARLY_PREMIERE_WINDOW_DAYS = 14;

  /** Max episodes the early-premiere snap-back may pull in. */
  private readonly EARLY_PREMIERE_MAX_EPISODES = 3;

  /** Minutes of slack around the closest runtime match when disambiguating OVA/ONA/SPECIAL/MUSIC entries by duration. */
  private readonly DURATION_MATCH_TOLERANCE_MINUTES = 2;

  /** Days added to "today" when capping an ongoing entry at "already aired", so early-streaming premieres aren't filtered out. */
  private readonly AIRED_CAP_LOOKAHEAD_DAYS = 7;

  /* ---------------------------- Candidate matching --------------------------- */

  /** Max distinct TMDB shows tried before giving up on an anime. */
  private readonly MAX_TMDB_CANDIDATE_ATTEMPTS = 6;

  /** Number of failed "uncurated" checks (out of 8) at which a TMDB show is rejected. */
  private readonly SPARSE_FIELD_THRESHOLD = 4;

  /** A finished entry resolving to less than this fraction of its reported episode count is treated as the wrong show. */
  private readonly MIN_EPISODE_COVERAGE = 0.5;

  /** Original languages considered plausible for anime. */
  private readonly ANIME_LANGUAGES = new Set(['ja', 'zh', 'ko', 'cn']);

  /** AniList/Kitsu statuses for entries with nothing on TMDB worth fetching yet. */
  private readonly UNRELEASED_STATUSES = new Set(['unreleased', 'not_yet_released', 'upcoming', 'tba']);

  /** Matches strings made only of ASCII characters (used to spot English-looking synonyms). */
  private readonly ASCII_ONLY = /^[\x00-\x7F]*$/;

  private readonly MONTH_NAMES = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];

  /* -------------------------------------------------------------------------- */
  /*                               Small utilities                              */
  /* -------------------------------------------------------------------------- */

  /** First 10 characters (`YYYY-MM-DD`) of an episode air date, or `null` when undated. */
  private toDay(airDate?: string | null): string | null {
    return airDate ? airDate.slice(0, 10) : null;
  }

  /**
   * Picks the best single title: English, then an ASCII-looking synonym, then
   * romaji, then native. Works for both the queried anime and franchise entries.
   */
  private extractTitle(media: TitleSource): string | undefined {
    return (
      media.title.english ||
      media.synonyms?.find(synonym => this.ASCII_ONLY.test(synonym)) ||
      media.title.romaji ||
      media.title.native ||
      undefined
    );
  }

  /** Extracts a plausible four-digit year from a year number or a date string. */
  private extractYear(releaseDate: string | null | number | undefined): number | null {
    if (releaseDate == null) return null;

    if (typeof releaseDate === 'number') {
      return releaseDate > 1000 && releaseDate < 3000 ? releaseDate : null;
    }

    const year = new Date(releaseDate).getFullYear();
    return Number.isNaN(year) ? null : year;
  }

  /**
   * Normalises any date shape from AniList/Kitsu into `YYYY-MM-DD`.
   *
   * Accepts `{ year, month, day }` objects, ISO strings (Kitsu), and
   * human-readable strings like "December 28, 2024" or "Jul 8, 2026" (AniList).
   * Returns `null` for anything unrecognised rather than guessing.
   */
  private parseDateToISO(date: unknown): string | null {
    if (!date) return null;

    if (typeof date === 'object') {
      const { year, month, day } = date as { year?: number; month?: number; day?: number };
      if (!year) return null;
      return `${year}-${String(month || 1).padStart(2, '0')}-${String(day || 1).padStart(2, '0')}`;
    }

    if (typeof date !== 'string') return null;

    const trimmed = date.trim();
    if (!trimmed || trimmed.toLowerCase() === 'unknown') return null;

    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);

    const match = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (!match) return null;

    const [, monthName, day, year] = match;
    const name = monthName.toLowerCase();
    const monthIndex = this.MONTH_NAMES.findIndex(
      full => name === full || name === full.slice(0, 3) || (name === 'sept' && full === 'september'),
    );

    return monthIndex === -1 ? null : `${year}-${String(monthIndex + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  /** Adds (or subtracts) whole days to a `YYYY-MM-DD` string using UTC arithmetic. */
  private addDaysToISO(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
  }

  /**
   * Lists every usable title in priority order for callers that loop through
   * search attempts: English, ASCII synonyms, romaji, native, then non-ASCII
   * synonyms as a last resort. Trimmed and de-duplicated case-insensitively.
   */
  private extractTitleCandidates(media: TitleSource): string[] {
    const synonyms = media.synonyms ?? [];
    const ordered = [
      media.title.english,
      ...synonyms.filter(synonym => this.ASCII_ONLY.test(synonym)),
      media.title.romaji,
      media.title.native,
      ...synonyms.filter(synonym => !this.ASCII_ONLY.test(synonym)),
    ];

    const seen = new Set<string>();
    const candidates: string[] = [];

    for (const value of ordered) {
      const trimmed = value?.trim();
      if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
      seen.add(trimmed.toLowerCase());
      candidates.push(trimmed);
    }

    return candidates;
  }

  /**
   * Picks the title/year/format used to anchor a TMDB show search. Not for
   * episode selection.
   *
   * Prefers the franchise's ROOT TV entry (so a "Season 3" query searches for
   * the original show) when it has both a title and a year. Otherwise falls back
   * to the first franchise entry with a title; its year may be `null`, which the
   * search accepts.
   */
  private findSearchAnchor(media: IRelatedAnimeData[]): SearchAnchor | undefined {
    const root = media.find(
      item => String(item.relationType ?? '').toUpperCase() === 'ROOT' && String(item.format ?? '').toUpperCase() === 'TV',
    );
    const rootTitle = root && this.extractTitle(root);

    if (root && rootTitle && root.year != null) {
      return { title: rootTitle, year: root.year, format: 'TV' };
    }

    const first = media[0];
    const title = first && this.extractTitle(first);
    if (!first || !title) return undefined;

    return { title, year: first.year ?? null, format: String(first.format ?? '').toUpperCase() };
  }

  /* -------------------------------------------------------------------------- */
  /*                            Episode range resolution                        */
  /* -------------------------------------------------------------------------- */

  /**
   * Index of the first episode on or after the start date (minus
   * `START_BOUNDARY_TOLERANCE_DAYS`).
   *
   * Returns `-1` when dated episodes exist but none reach the start date: the
   * pool ended before the entry began, so it can't be the right show. Returns
   * `0` when no episode has a date at all.
   */
  private locateStartIndexByDate(episodes: IMetaMovieEpisodes[], startStr: string): number {
    const toleratedStart = this.addDaysToISO(startStr, -this.START_BOUNDARY_TOLERANCE_DAYS);
    let sawDated = false;

    for (let i = 0; i < episodes.length; i++) {
      const day = this.toDay(episodes[i].airDate);
      if (!day) continue;
      sawDated = true;
      if (toleratedStart <= day) return i;
    }

    return sawDated ? -1 : 0;
  }

  /**
   * Handles early/advance streaming premieres. When the anchor isn't episode 1
   * of its season but every episode before it aired within
   * `EARLY_PREMIERE_WINDOW_DAYS` of the source start date, and walking back
   * reaches episode 1, the anchor moves back to that episode.
   *
   * Genuine mid-season cour splits (e.g. cour 2 starting at episode 13) are
   * unaffected because their earlier episodes aired months before.
   *
   * @example
   * AniList says "October 3", but episodes 1 and 2 dropped together and TMDB
   * dates episode 1 a week earlier. Without this, episode 1 would be lost.
   */
  private snapBackForEarlyPremiere(episodes: IMetaMovieEpisodes[], startIndex: number, startStr: string): number {
    const anchor = episodes[startIndex];
    if (!anchor || Number(anchor.episodeNumber) <= 1) return startIndex;

    const windowStart = this.addDaysToISO(startStr, -this.EARLY_PREMIERE_WINDOW_DAYS);
    let idx = startIndex;

    for (let steps = 0; idx > 0 && steps < this.EARLY_PREMIERE_MAX_EPISODES; steps++) {
      const prev = episodes[idx - 1];
      const day = this.toDay(prev.airDate);
      if (prev.seasonNumber !== anchor.seasonNumber || !day || day < windowStart) break;
      idx--;
    }

    return Number(episodes[idx].episodeNumber) <= 1 ? idx : startIndex;
  }

  /**
   * Keeps everything from `startIndex` up to what has aired (today plus
   * `AIRED_CAP_LOOKAHEAD_DAYS`). Undated episodes are kept. If the source says
   * the entry already started, the anchor episode is always kept even if TMDB
   * dates it later.
   */
  private filterAiredFromIndex(episodes: IMetaMovieEpisodes[], startIndex: number, startStr: string): IMetaMovieEpisodes[] {
    const today = new Date().toISOString().slice(0, 10);
    const cutoff = this.addDaysToISO(today, this.AIRED_CAP_LOOKAHEAD_DAYS);
    const sourceSaysStarted = startStr <= today;

    return episodes.filter((ep, i) => {
      if (i < startIndex) return false;
      if (i === startIndex && sourceSaysStarted) return true;
      const day = this.toDay(ep.airDate);
      return !day || day <= cutoff;
    });
  }

  /**
   * Narrows the sorted, all-seasons episode list to the subset that plausibly
   * belongs to the queried entry.
   *
   * - **TV**: seasons > 0 only. TMDB uses season 0 as a bucket for specials.
   * - **Has a duration** (ONA/OVA/SPECIAL/MUSIC): keep episodes whose runtime
   *   matches, since TMDB often lumps unrelated specials into season 0. Skipped
   *   when the unfiltered pool already has exactly the reported episode count
   *   and the filter would break that, as with anthologies whose episode
   *   runtimes vary widely.
   * - **No duration, no TV parent**: use every episode.
   * - **No duration, TV parent**: choose season 0 or the numbered seasons by
   *   start date, because some ONAs sit under a numbered season (e.g. Steel Ball
   *   Run as JoJo season 6). Without a start date, defaults to season 0.
   */
  private selectCandidateEpisodes(
    episodes: IMetaMovieEpisodes[],
    animeFormat: string | null,
    animeData: IMetaAnime,
    hasTvParent: boolean,
    startStr: string | null,
  ): IMetaMovieEpisodes[] {
    if (animeFormat === 'TV') {
      return episodes.filter(ep => Number(ep.seasonNumber) > 0);
    }

    const animeDuration = 'duration' in animeData ? (animeData.duration as number | null | undefined) : null;

    if (animeDuration && animeDuration > 0) {
      const byDuration = this.filterByClosestDuration(episodes, animeDuration);
      const episodeCount = 'episodes' in animeData ? (animeData.episodes as number | null | undefined) : null;
      const unfilteredMatchesCount = episodeCount != null && episodeCount > 0 && episodes.length === episodeCount;

      return unfilteredMatchesCount && byDuration.length !== episodeCount ? episodes : byDuration;
    }

    if (!hasTvParent) return episodes;

    const season0 = episodes.filter(ep => Number(ep.seasonNumber) === 0);
    const numbered = episodes.filter(ep => Number(ep.seasonNumber) > 0);

    if (startStr === null) return season0;

    const cutoff = this.addDaysToISO(startStr, -this.START_BOUNDARY_TOLERANCE_DAYS);
    const reachesStart = (list: IMetaMovieEpisodes[]) =>
      list.some(ep => {
        const day = this.toDay(ep.airDate);
        return day !== null && cutoff <= day;
      });

    if (reachesStart(season0)) return season0;
    if (reachesStart(numbered)) return numbered;

    // Nothing reaches the start date; the wrong-show guard in buildParsedEpisodes rejects this show.
    return season0.length > 0 ? season0 : episodes;
  }

  /**
   * Keeps every episode whose runtime is within
   * `DURATION_MATCH_TOLERANCE_MINUTES` of the closest match, so a uniform
   * multi-episode OVA/special run is kept whole. Returns the input unchanged
   * when no episode has a runtime.
   */
  private filterByClosestDuration(episodes: IMetaMovieEpisodes[], targetDuration: number): IMetaMovieEpisodes[] {
    const withRuntime = episodes
      .map(ep => ({ ep, runtime: ep.runtime == null ? NaN : Number(ep.runtime) }))
      .filter(({ runtime }) => !Number.isNaN(runtime));

    if (withRuntime.length === 0) return episodes;

    const closestDiff = Math.min(...withRuntime.map(({ runtime }) => Math.abs(runtime - targetDuration)));

    return withRuntime
      .filter(({ runtime }) => Math.abs(runtime - targetDuration) <= closestDiff + this.DURATION_MATCH_TOLERANCE_MINUTES)
      .map(({ ep }) => ep);
  }

  /**
   * Resolves the final episode list for the queried entry from the candidate
   * pool, using whichever date/count metadata the source provides.
   *
   * 1. Pool size equals the reported count: return the pool.
   * 2. No start date: return the pool.
   * 3. Locate the start (with early-premiere snap-back); none found returns `[]`.
   * 4. No end date and no count: everything aired since the start.
   * 5. Otherwise work within the anchor's TMDB season, widening to the whole
   *    pool when the count or end date shows the entry spans several seasons,
   *    then cut by end date or by count.
   */
  private resolveEpisodeRange(
    episodes: IMetaMovieEpisodes[],
    startStr: string | null,
    endStr: string | null,
    episodeCount: number | null,
  ): IMetaMovieEpisodes[] {
    const count = episodeCount && episodeCount > 0 ? episodeCount : 0;

    if (count > 0 && episodes.length === count) return episodes;
    if (startStr === null) return episodes;

    const rawStartIndex = this.locateStartIndexByDate(episodes, startStr);
    if (rawStartIndex < 0 || rawStartIndex >= episodes.length) return [];

    const startIndex = this.snapBackForEarlyPremiere(episodes, rawStartIndex, startStr);

    if (endStr === null && count === 0) {
      return this.filterAiredFromIndex(episodes, startIndex, startStr);
    }

    const anchor = episodes[startIndex];
    const seasonEpisodes = episodes.filter(ep => ep.seasonNumber === anchor.seasonNumber);
    const seasonLastDay = this.toDay(seasonEpisodes[seasonEpisodes.length - 1]?.airDate);

    const countExceedsSeason = count > seasonEpisodes.length;
    const dateExceedsSeason =
      endStr !== null &&
      seasonLastDay !== null &&
      endStr > this.addDaysToISO(seasonLastDay, this.COUR_BOUNDARY_TOLERANCE_DAYS);

    const spansSeasons = countExceedsSeason || dateExceedsSeason;
    const pool = spansSeasons ? episodes : seasonEpisodes;
    const poolStart = spansSeasons ? startIndex : seasonEpisodes.indexOf(anchor);

    if (endStr !== null) {
      return this.resolveRangeWithEndDate(pool, poolStart, endStr, count);
    }

    return pool.slice(poolStart, poolStart + count);
  }

  /**
   * Resolves the end of a range that has a known end date.
   *
  
   */
  private resolveRangeWithEndDate(
    episodes: IMetaMovieEpisodes[],
    startIndex: number,
    endStr: string,
    count: number,
  ): IMetaMovieEpisodes[] {
    const lower = this.addDaysToISO(endStr, -this.COUR_BOUNDARY_TOLERANCE_DAYS);
    const upper = this.addDaysToISO(endStr, this.COUR_BOUNDARY_TOLERANCE_DAYS);

    const boundaryIndex = episodes.findIndex(
      (ep, i) => i >= startIndex && (ep.episodeType === 'mid_season' || ep.episodeType === 'finale'),
    );
    const boundaryDate = boundaryIndex === -1 ? null : this.toDay(episodes[boundaryIndex].airDate);

    if (boundaryDate && boundaryDate >= lower && boundaryDate <= upper) {
      return episodes.slice(startIndex, boundaryIndex + 1);
    }

    let range = episodes.filter((ep, i) => {
      if (i < startIndex) return false;
      const day = this.toDay(ep.airDate);
      return !day || day <= endStr;
    });

    if (count > 0 && range.length !== count) {
      const bySlice = episodes.slice(startIndex, startIndex + count);
      if (bySlice.length === count) range = bySlice;
    }

    return range;
  }

  /** True for null, undefined, blank strings, and empty arrays. */
  private isEmptyValue(value: unknown): boolean {
    return value == null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0);
  }

  /** True when an image object (small/medium/large/original) has at least one non-empty URL. */
  private hasImage(image: unknown): boolean {
    if (!image || typeof image !== 'object') return false;
    return Object.values(image).some(url => typeof url === 'string' && url.trim().length > 0);
  }

  /**
   * Decides whether a fetched TMDB show is a real, curated entry.
   *
   * - **Hard rule**: rejected when it has no poster, no backdrop, AND no
   *   artwork of any kind. Such a show is an uncurated ghost entry even if a
   *   stray vote gave it a rating.
   * - **Soft rule**: rejected when `SPARSE_FIELD_THRESHOLD` or more of 8 checks
   *   fail (poster, backdrop, rating, genres, summary, artwork, country,
   *   anime-plausible language).
   */
  private assessShowQuality(show: Partial<IAnimeTVMetaInfo>): { isRejected: boolean; reason: string } {
    const art = show.artWorks;
    const noPoster = !this.hasImage(show.posterImage);
    const noBackdrop = !this.hasImage(show.backdrop);
    const noArtwork =
      !art || (this.isEmptyValue(art.backdrop) && this.isEmptyValue(art.logos) && this.isEmptyValue(art.posterImages));

    if (noPoster && noBackdrop && noArtwork) {
      return { isRejected: true, reason: 'no poster, cover or artwork' };
    }

    const checks: Record<string, boolean> = {
      posterImage: noPoster,
      backdrop: noBackdrop,
      rating: show.rating == null,
      genres: this.isEmptyValue(show.genres),
      summary: this.isEmptyValue(show.summary),
      artWorks: noArtwork,
      country: this.isEmptyValue(show.country),
      language: this.isEmptyValue(show.language) || !this.ANIME_LANGUAGES.has(String(show.language).toLowerCase()),
    };

    const missing = Object.keys(checks).filter(key => checks[key]);

    return missing.length >= this.SPARSE_FIELD_THRESHOLD
      ? { isRejected: true, reason: `sparse (${missing.join(', ')})` }
      : { isRejected: false, reason: '' };
  }

  /**
   * Blacklist-aware candidate selection. The blacklist is applied BEFORE the
   * single-result shortcut so a lone junk result isn't trusted again on retry.
   *
   * @param trustSingle - Accept a lone remaining result without similarity scoring.
   */
  private pickCandidate(
    title: string,
    year: number | null,
    results: IMetaMovie[] | null | undefined,
    minThreshold: number,
    blacklist: ReadonlySet<number>,
    trustSingle = false,
  ): IMetaMovie | null {
    const pool = (results ?? []).filter(result => !blacklist.has(result.tmdbId));
    if (pool.length === 0) return null;
    if (pool.length === 1 && trustSingle) return pool[0];
    return this.findBestMatch(title, year, pool, minThreshold);
  }

  /**
   * Scores title similarity from 0 to 1. Takes the best of Levenshtein
   * similarity and token overlap, and floors substring matches at 0.75.
   */
  private calculateTitleSimilarity(target: string, candidate: string): number {
    const a = target.toLowerCase().trim();
    const b = candidate.toLowerCase().trim();

    if (!a || !b) return 0;
    if (a === b) return 1;

    const levSimilarity = 1 - this.levenshtein(a, b) / Math.max(a.length, b.length, 1);

    const tokenize = (value: string) => new Set(value.split(/[\s:,\-_]+/).filter(Boolean));
    const tokensA = tokenize(a);
    const tokensB = tokenize(b);
    const overlap = [...tokensA].filter(token => tokensB.has(token)).length;
    const minTokens = Math.min(tokensA.size, tokensB.size);
    const tokenSimilarity = minTokens > 0 ? overlap / minTokens : 0;

    const score = Math.max(levSimilarity, tokenSimilarity);
    const isSubstring = a.includes(b) || b.includes(a);

    return isSubstring && score < 0.75 ? 0.75 : score;
  }

  /** Two-row Levenshtein edit distance. */
  private levenshtein(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, j) => j);

    for (let i = 1; i <= a.length; i++) {
      const current = [i];
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      }
      previous = current;
    }

    return previous[b.length];
  }

  /**
   * Picks the candidate with the best title similarity (checked against both
   * `name` and `originalName`), with a +0.2 bonus for a matching release year.
   * Candidates below `minThreshold` similarity are ignored.
   */
  private findBestMatch(
    title: string,
    year: number | null,
    candidates: IMetaMovie[],
    minThreshold = 0.7,
  ): IMetaMovie | null {
    let best: IMetaMovie | null = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      const similarity = Math.max(
        this.calculateTitleSimilarity(title, candidate.name ?? ''),
        this.calculateTitleSimilarity(title, candidate.originalName ?? ''),
      );
      if (similarity < minThreshold) continue;

      const candidateYear = this.extractYear(candidate.releaseDate);
      const score = similarity + (year !== null && candidateYear === year ? 0.2 : 0);

      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return best;
  }

  /**
   * Fetches every TMDB episode for a show and narrows it to the entry's range.
   * Runs once per TMDB candidate inside the retry loop.
   *
.
   *
   * Episodes in the result carry a continuous `absoluteEpisodeNumber`;
   * `episodeNumber` stays the season-relative number from TMDB.
   */
  private async buildParsedEpisodes(
    tmdbId: number,
    showInfo: Partial<IAnimeTVMetaInfo>,
    animeData: IMetaAnime,
    hasTvParent: boolean,
  ): Promise<IResponse<IMetaMovieEpisodes[] | null>> {
    const seasonNumbers = (showInfo.seasons ?? []).map(season => Number(season.seasonNumber));

    if (seasonNumbers.length === 0) {
      return { data: null, error: 'No season data available', status: 404 };
    }

    const episodesResponse = await this.fetchTvEpisodesRange(tmdbId, Math.min(...seasonNumbers), Math.max(...seasonNumbers));

    if (!episodesResponse.data?.length) {
      return {
        data: null,
        error: episodesResponse.error ?? 'No episodes returned',
        status: episodesResponse.status ?? 404,
      };
    }

    if (episodesResponse.error) {
      console.warn(`[AnimeMeta] tmdbId=${tmdbId}: ${episodesResponse.error}`);
    }

    const startStr = this.parseDateToISO(animeData.releaseDate);
    const endStr = 'endDate' in animeData ? this.parseDateToISO(animeData.endDate) : null;
    const episodeCount = 'episodes' in animeData ? ((animeData.episodes as number | null | undefined) ?? null) : null;
    const animeFormat = 'format' in animeData && animeData.format ? String(animeData.format).toUpperCase() : null;

    const candidateEpisodes = this.selectCandidateEpisodes(
      episodesResponse.data,
      animeFormat,
      animeData,
      hasTvParent,
      startStr,
    );

    if (candidateEpisodes.length === 0) {
      return { data: null, error: 'Could not narrow down a matching episode set', status: 404 };
    }

    const poolMatchesCount = episodeCount != null && episodeCount > 0 && candidateEpisodes.length === episodeCount;

    if (startStr !== null && !poolMatchesCount && this.locateStartIndexByDate(candidateEpisodes, startStr) === -1) {
      return { data: null, error: `no TMDB episodes on/after ${startStr} (wrong show?)`, status: 404 };
    }

    const rangeEpisodes = this.resolveEpisodeRange(candidateEpisodes, startStr, endStr, episodeCount);

    return { data: rangeEpisodes.map((ep, index) => ({ ...ep, absoluteEpisodeNumber: index + 1 })) };
  }

  /**
   * Fetches episodes for seasons `minSeason..maxSeason` (inclusive), up to
   * `concurrency` at a time, sorted by season, episode number, then air date.
   *
   * Partial failures return the episodes that were fetched with status 206 and
   * an error naming the failed seasons.
   */
  private async fetchTvEpisodesRange(
    tmdbId: number,
    minSeason: number,
    maxSeason: number,
    concurrency = 10,
  ): Promise<IResponse<IMetaMovieEpisodes[] | []>> {
    if (!tmdbId) {
      return { error: 'Missing required params: tmdbId!', data: [] };
    }
    if (minSeason == null || maxSeason == null) {
      return { error: 'Missing required params: minSeason/maxSeason!', data: [] };
    }
    if (minSeason > maxSeason) {
      return { error: 'Invalid season range: minSeason cannot be greater than maxSeason!', data: [] };
    }

    try {
      const seasons = Array.from({ length: maxSeason - minSeason + 1 }, (_, i) => minSeason + i);
      const allEpisodes: IMetaMovieEpisodes[] = [];
      const failedSeasons: number[] = [];
      let next = 0;

      const workers = Array.from({ length: Math.min(concurrency, seasons.length) }, async () => {
        while (next < seasons.length) {
          const season = seasons[next++];

          try {
            const result = await this.tmdb.fetchTvEpisodes(tmdbId, season);
            if (!result.error && result.data?.length) {
              allEpisodes.push(...result.data);
            } else {
              failedSeasons.push(season);
            }
          } catch {
            failedSeasons.push(season);
          }
        }
      });

      await Promise.allSettled(workers);

      const toTime = (dateStr?: string | null): number | null => {
        const time = dateStr ? new Date(dateStr).getTime() : NaN;
        return Number.isNaN(time) ? null : time;
      };

      allEpisodes.sort((a, b) => {
        const seasonDiff = (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0);
        if (seasonDiff !== 0) return seasonDiff;

        const episodeDiff = (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0);
        if (episodeDiff !== 0) return episodeDiff;

        const timeA = toTime(a.airDate);
        const timeB = toTime(b.airDate);
        if (timeA !== null && timeB !== null) return timeA - timeB;
        if (timeA !== null) return -1;
        if (timeB !== null) return 1;
        return 0;
      });

      if (failedSeasons.length > 0) {
        return {
          data: allEpisodes,
          error: `Incomplete result: failed to fetch season(s) ${failedSeasons.join(', ')}`,
          status: 206,
        };
      }

      return { data: allEpisodes };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error', data: [] };
    }
  }

  /** Runs a TMDB movie or show search. Never throws; failures come back as an empty paginated result with `error` set. */
  private async searchMedia(
    query: string,
    type: string,
    year: number | null,
  ): Promise<IMetaMoviePaginated<IMetaMovie[] | []>> {
    const empty = (error?: string, status?: number) => ({
      hasNextPage: false,
      currentPage: 0,
      totalResults: 0,
      lastPage: 0,
      data: [] as [],
      error,
      status,
    });

    try {
      const targetYear = year ?? undefined;
      const response =
        type.toUpperCase() === 'MOVIE'
          ? await this.tmdb.searchMovie(query, 1, targetYear)
          : await this.tmdb.searchShows(query, 1, targetYear);

      return response.error || !response.data ? empty(response.error, response.status) : response;
    } catch (error) {
      return empty(error instanceof Error ? error.message : 'Unknown error', 500);
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                                 TV resolution                              */
  /* -------------------------------------------------------------------------- */

  /**
   * Finds the best TMDB show for an AniList entry, skipping every id in
   * `blacklist`.
   *
   * Searches progressively and returns the first acceptable match:
   * 1. Franchise root title
   * 2. Root title + year, falling back to every title variant of the first
   *    franchise entry when this yields nothing usable
   * 3. Queried entry's title (a lone un-blacklisted result is trusted)
   * 4. Queried entry's title + year
   */
  private async fetchTheMovieDatabaseTv(
    anilistId: number,
    preResolvedAnimeData?: IMetaAnime,
    blacklist: ReadonlySet<number> = new Set(),
  ): Promise<IResponse<IMetaMovie | null>> {
    try {
      let animeData = preResolvedAnimeData ?? null;

      if (!animeData) {
        const directInfo = await this.resolver.resolveAnimeInfo(anilistId);
        if (!directInfo.error && directInfo.data) animeData = directInfo.data;
      }

      if (!animeData) return { data: null, error: 'Could not resolve anime information', status: 404 };

      const animeTitle = this.extractTitle(animeData);
      if (!animeTitle) return { data: null, error: 'Could not resolve anime title', status: 400 };

      const animeYear = this.extractYear('year' in animeData && animeData.year ? animeData.year : animeData.releaseDate);

      const franchise = await this.resolver.resolveFranchiseMedia(anilistId);
      if (franchise.error || !franchise.data) {
        return {
          data: null,
          error: franchise.error ?? 'Could not resolve franchise media',
          status: franchise.status ?? 404,
        };
      }

      const anchor = this.findSearchAnchor(franchise.data);
      if (!anchor) return { data: null, error: 'Could not resolve root title/year/format', status: 404 };

      let search = await this.searchMedia(anchor.title, anchor.format, null);
      if (search.error) return { data: null, error: search.error, status: search.status };

      let match = this.pickCandidate(anchor.title, anchor.year, search.data, 0.5, blacklist);
      if (match) return { data: match };

      search = await this.searchMedia(anchor.title, anchor.format, anchor.year);

      const first = franchise.data[0];
      if (first && !search.data.some(result => !blacklist.has(result.tmdbId))) {
        const firstYear = first.year ?? null;

        for (const candidateTitle of this.extractTitleCandidates(first)) {
          const variant = await this.searchMedia(candidateTitle, 'TV', firstYear);
          if (variant.error) continue;

          match = this.pickCandidate(candidateTitle, firstYear, variant.data, 0.5, blacklist, true);
          if (match) return { data: match };
        }
      }

      if (search.error) return { data: null, error: search.error, status: search.status };

      match = this.pickCandidate(anchor.title, anchor.year, search.data, 0.5, blacklist);
      if (match) return { data: match };

      search = await this.searchMedia(animeTitle, 'TV', null);
      if (search.error) return { data: null, error: search.error, status: search.status };

      match = this.pickCandidate(animeTitle, animeYear, search.data, 0.7, blacklist, true);
      if (match) return { data: match };

      if (animeYear !== null) {
        search = await this.searchMedia(animeTitle, 'TV', animeYear);
        if (search.error) return { data: null, error: search.error, status: search.status };

        match = this.pickCandidate(animeTitle, animeYear, search.data, 0.7, blacklist);
        if (match) return { data: match };
      }

      return { data: null, error: 'Could not disambiguate TMDB matches', status: 404 };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : 'Unknown error', status: 500 };
    }
  }

  private async fetchTheMovieDatabaseTvMeta(
    anilistId: number,
    preResolvedAnimeData?: IMetaAnime,
  ): Promise<IResponse<IAnimeTVMetaInfo | null>> {
    try {
      let animeData = preResolvedAnimeData;

      if (!animeData) {
        const infoResponse = await this.resolver.resolveAnimeInfo(anilistId);
        if (infoResponse.error || !infoResponse.data) {
          return { data: null, error: infoResponse.error, status: infoResponse.status };
        }
        animeData = infoResponse.data;
      }

      const mediaResponse = await this.resolver.resolveFranchiseMedia(anilistId);
      if (mediaResponse.error || !mediaResponse.data) {
        return {
          data: null,
          error: mediaResponse.error ?? 'Could not resolve franchise media',
          status: mediaResponse.status ?? 404,
        };
      }

      const hasTvParent = mediaResponse.data.some(
        item => String(item.relationType ?? '').toUpperCase() === 'ROOT' && String(item.format ?? '').toUpperCase() === 'TV',
      );

      const reportedEpisodeCount =
        'episodes' in animeData ? ((animeData.episodes as number | null | undefined) ?? null) : null;
      const reportedStatus = ('status' in animeData ? String(animeData.status ?? '') : '').toLowerCase();
      const isAiring = reportedStatus === 'releasing' || reportedStatus === 'current';

      const mappings = await getByAnilistId(anilistId);
      const cachedTmdbId = mappings?.tmdb_id ? Number(mappings.tmdb_id) : null;

      const blacklist = new Set<number>();
      const rejections: string[] = [];
      let lastError = 'Could not resolve a usable TMDB show';
      let lastStatus = 404;

      const reject = (tmdbId: number, reason: string) => {
        blacklist.add(tmdbId);
        rejections.push(`${tmdbId} (${reason})`);
        console.warn(`[AnimeMeta] anilistId=${anilistId} blacklisting tmdbId=${tmdbId}: ${reason}`);
      };

      for (let attempt = 0; attempt < this.MAX_TMDB_CANDIDATE_ATTEMPTS; attempt++) {
        let tmdbId: number;

        if (attempt === 0 && cachedTmdbId) {
          tmdbId = cachedTmdbId;
        } else {
          const tvResponse = await this.fetchTheMovieDatabaseTv(anilistId, animeData, blacklist);

          if (tvResponse.error || !tvResponse.data?.tmdbId) {
            if (rejections.length === 0) {
              lastError = tvResponse.error ?? lastError;
              lastStatus = tvResponse.status ?? 404;
            }
            break;
          }

          tmdbId = Number(tvResponse.data.tmdbId);
        }

        const showResult = await this.tmdb.fetchShowInfo(tmdbId);

        if (showResult.error || !showResult.data) {
          lastStatus = showResult.status || 404;
          reject(tmdbId, `fetchShowInfo failed: ${showResult.error || 'Season data not available'}`);
          continue;
        }

        const showInfo = showResult.data;
        const quality = this.assessShowQuality(showInfo);

        if (quality.isRejected) {
          lastStatus = 404;
          reject(tmdbId, quality.reason);
          continue;
        }

        const episodesResult = await this.buildParsedEpisodes(tmdbId, showInfo, animeData, hasTvParent);
        const finalEpisodes = episodesResult.data ?? [];

        const earlyAiringNoEpisodes = isAiring && !episodesResult.error && finalEpisodes.length === 0;

        if (earlyAiringNoEpisodes) {
          console.warn(
            `[AnimeMeta] anilistId=${anilistId} tmdbId=${tmdbId}: source reports airing but TMDB has no aired episodes yet; returning empty parsedEpisodes`,
          );
        } else {
          const tooFew =
            !isAiring &&
            reportedEpisodeCount != null &&
            reportedEpisodeCount > 0 &&
            finalEpisodes.length < reportedEpisodeCount * this.MIN_EPISODE_COVERAGE;

          if (episodesResult.error || finalEpisodes.length === 0 || tooFew) {
            lastStatus = episodesResult.status ?? 404;
            reject(tmdbId, episodesResult.error ?? `episodes ${finalEpisodes.length}/${reportedEpisodeCount ?? '?'}`);
            continue;
          }
        }

        await upsertMapping(anilistId, undefined, { tmdbId });

        return { data: { ...showInfo, parsedEpisodes: finalEpisodes } };
      }

      return {
        data: null,
        error: rejections.length > 0 ? `All TMDB candidates rejected: ${rejections.join('; ')}` : lastError,
        status: lastStatus,
      };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : 'Unknown error', status: 500 };
    }
  }

  private async fetchTheMovieDatabaseMovieMeta(
    anilistId: number,
    preResolvedAnimeData?: IMetaAnime,
    forceSearch = false,
  ): Promise<IResponse<IAnimeMovieMetaInfo | null>> {
    try {
      let animeData = preResolvedAnimeData;

      if (!animeData) {
        const infoResponse = await this.resolver.resolveAnimeInfo(anilistId);
        if (infoResponse.error || !infoResponse.data) {
          return { data: null, error: infoResponse.error, status: infoResponse.status };
        }
        animeData = infoResponse.data;
      }

      const mappings = forceSearch ? null : await getByAnilistId(anilistId);
      let tmdbId = mappings?.tmdb_id ? Number(mappings.tmdb_id) : null;

      if (!tmdbId) {
        const title = this.extractTitle(animeData);
        const year = this.extractYear('year' in animeData && animeData.year ? animeData.year : animeData.releaseDate);

        if (!title) return { data: null, error: 'Could not resolve title for TMDB search', status: 400 };

        let tmdbResult = await this.searchMedia(title, 'MOVIE', null);

        if (!tmdbResult.data?.length && year !== null) {
          tmdbResult = await this.searchMedia(title, 'MOVIE', year);
        }

        if (tmdbResult.error) return { data: null, error: tmdbResult.error, status: tmdbResult.status };
        if (!tmdbResult.data?.length) return { data: null, error: 'No TMDB match found', status: 404 };

        const bestMatch =
          tmdbResult.data.length === 1 ? tmdbResult.data[0] : this.findBestMatch(title, year, tmdbResult.data, 0.5);

        if (!bestMatch) return { data: null, error: 'Could not disambiguate TMDB matches', status: 404 };

        tmdbId = Number(bestMatch.tmdbId);

        await upsertMapping(anilistId, undefined, { tmdbId });
      }

      const movieInfo = await this.tmdb.fetchMovieInfo(tmdbId);
      if (movieInfo.error || !movieInfo.data) return { data: null, error: movieInfo.error, status: movieInfo.status };

      const backdropImage = movieInfo.data.artWorks?.backdrop?.[0];
      if (!backdropImage) return { data: null, error: 'No backdrop artwork available for this movie', status: 404 };

      const episodeMeta: IMetaMovieEpisodes = {
        airDate: movieInfo.data.releaseDate,
        episodeNumber: 1,
        absoluteEpisodeNumber: 1,
        episodeType: 'movie',
        tmdbEpisodeId: null,
        title: movieInfo.data.name ?? movieInfo.data.originalName,
        summary: movieInfo.data.summary ?? null,
        rating: movieInfo.data.rating ? Number(movieInfo.data.rating) : null,
        seasonNumber: null,
        tmdbId: movieInfo.data.tmdbId,
        runtime: movieInfo.data.runtime ? String(movieInfo.data.runtime) : null,
        images: backdropImage,
      };

      const result: IAnimeMovieMetaInfo = {
        ...movieInfo.data,
        seasons: [],
        parsedEpisodes: [episodeMeta],
      };

      return { data: result };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : 'Unknown error', status: 500 };
    }
  }

  /**
   * Fetches TMDB metadata and the matching episode list for an AniList entry.
   * Resolves the anime once and tries the TV path first, falling back to a
   * TMDB movie search when the TV path finds nothing usable.
   *
   * @param anilistId - AniList media ID.
   * @returns Movie or TV metadata with `parsedEpisodes`, or an error response
   *   (400 for unreleased entries, 404 when nothing usable was found).
   */
  public async fetchAnimeMeta(anilistId: number): Promise<IResponse<IAnimeMovieMetaInfo | IAnimeTVMetaInfo | null>> {
    try {
      const infoResponse = await this.resolver.resolveAnimeInfo(anilistId);

      if (infoResponse.error || !infoResponse.data) {
        return { data: null, error: infoResponse.error, status: infoResponse.status };
      }

      const animeData = infoResponse.data;

      if (this.UNRELEASED_STATUSES.has(animeData.status?.toLowerCase() ?? '')) {
        return { data: null, error: 'Not yet released', status: 400 };
      }
      const format = animeData.format ? String(animeData.format).toUpperCase() : null;
      const episodeCount = animeData.episodes != null ? Number(animeData.episodes) : null;

      if (format === 'MOVIE' && episodeCount !== null && episodeCount <= 1) {
        return await this.fetchTheMovieDatabaseMovieMeta(anilistId, animeData);
      }

      const tvResponse = await this.fetchTheMovieDatabaseTvMeta(anilistId, animeData);
      if (!tvResponse.error && tvResponse.data) return tvResponse;

      console.warn(
        `[AnimeMeta] TV metadata resolution failed for anilistId=${anilistId}; trying TMDB movie search. Error: ${tvResponse.error ?? 'No TV metadata returned'}`,
      );

      const movieResponse = await this.fetchTheMovieDatabaseMovieMeta(anilistId, animeData, true);
      if (!movieResponse.error && movieResponse.data) return movieResponse;

      return {
        data: null,
        error: [
          `TV lookup failed: ${tvResponse.error ?? 'No TV metadata returned'}`,
          `Movie lookup failed: ${movieResponse.error ?? 'No movie metadata returned'}`,
        ].join('; '),
        status: movieResponse.status ?? tvResponse.status ?? 404,
      };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : 'Unknown error', status: 500 };
    }
  }
}

export { AnimeTmdb };
