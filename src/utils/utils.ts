interface ProviderEpisode {
  title: string | null;
  hasSub: boolean;
  hasDub: boolean;
  episodeId: string | null;
  episodeNumber: number | null;
}

export function isValidDate(dateString: string): boolean {
  const regEx = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  if (!regEx.test(dateString)) return false;

  const date = new Date(dateString);
  const timestamp = date.getTime();

  if (typeof timestamp !== 'number' || isNaN(timestamp)) return false;

  return date.toISOString().startsWith(dateString);
}
