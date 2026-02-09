interface ProviderEpisode {
  title: string | null;
  hasSub: boolean;
  hasDub: boolean;
  episodeId: string | null;
  episodeNumber: number | null;
}

export function splitEpisodes(episodes: ProviderEpisode[]) {
  const sub: number[] = [];
  const dub: number[] = [];

  for (const ep of episodes) {
    if (ep.hasSub && ep.episodeNumber !== null) sub.push(ep.episodeNumber);
    if (ep.hasDub && ep.episodeNumber !== null) dub.push(ep.episodeNumber);
  }

  return {
    sub: [...new Set(sub)].sort((a, b) => a - b),
    dub: [...new Set(dub)].sort((a, b) => a - b),
  };
}
