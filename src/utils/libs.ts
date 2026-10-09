import { token_sort_ratio } from 'fuzzball';

interface AnimeResult {
  id: string | number | null;
  name: string | null;
  romaji: string | null;
}

interface AnilistTitles {
  english: string | null;
  romaji: string | null;
}

export function findBestMatch(target: AnilistTitles, candidates: AnimeResult[], minScoreThreshold = 60): AnimeResult | null {
  if (!candidates || candidates.length === 0) return null;

  let bestMatch: AnimeResult | null = null;
  let bestScore = -1;

  const targetTitles = [target.english, target.romaji]
    .filter((title): title is string => Boolean(title && title.trim()))
    .map(title => title.toLowerCase());

  if (targetTitles.length === 0) return null;

  for (const candidate of candidates) {
    const candidateTitles = [candidate.name, candidate.romaji]
      .filter((title): title is string => Boolean(title && title.trim()))
      .map(title => title.toLowerCase());

    let candidateBestScore = 0;

    for (const tTitle of targetTitles) {
      for (const cTitle of candidateTitles) {
        const score = token_sort_ratio(tTitle, cTitle);
        candidateBestScore = Math.max(candidateBestScore, score);
      }
    }

    if (candidateBestScore > bestScore) {
      bestScore = candidateBestScore;
      bestMatch = candidate;
    }
  }

  return bestScore >= minScoreThreshold ? bestMatch : null;
}
