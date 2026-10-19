import { supabase } from './client.js';

const TABLE = 'anime_mappings';

export type Mapping = {
  anilist_id: number;
  tmdb_id: number | null;
  tvdb_id: number | null;
  imdb_id: string | null;
  media_type: string | null;
  imdb_start: string | null;
  imdb_end: string | null;
  tmdb_start: string | null;
  tmdb_end: string | null;
  tvdb_start: string | null;
  tvdb_end: string | null;
};

const COLUMNS =
  'anilist_id, tmdb_id, tvdb_id, imdb_id, media_type, ' + 'imdb_start, imdb_end, tmdb_start, tmdb_end, tvdb_start, tvdb_end';

export type MappingIds = {
  tmdbId?: number;
  tvdbId?: number;
  imdbId?: string;
  imdbStart?: string | null;
  imdbEnd?: string | null;
  tmdbStart?: string | null;
  tmdbEnd?: string | null;
  tvdbStart?: string | null;
  tvdbEnd?: string | null;
};

// READ:
export async function getByAnilistId(anilistId: number): Promise<Mapping | null> {
  if (!supabase) return null;

  const { data, error } = await supabase.from(TABLE).select(COLUMNS).eq('anilist_id', anilistId).maybeSingle<Mapping>();

  if (error) throw error;
  return data;
}

// CREATE / UPDATE:
export async function upsertMapping(anilistId: number, mediaType?: string, ids: MappingIds = {}): Promise<void> {
  if (!supabase) return;

  const row: Record<string, unknown> = { anilist_id: anilistId };

  if (mediaType !== undefined) row.media_type = mediaType;
  if (ids.tmdbId !== undefined) row.tmdb_id = ids.tmdbId;
  if (ids.tvdbId !== undefined) row.tvdb_id = ids.tvdbId;
  if (ids.imdbId !== undefined) row.imdb_id = ids.imdbId;

  if (ids.imdbStart !== undefined) row.imdb_start = ids.imdbStart;
  if (ids.imdbEnd !== undefined) row.imdb_end = ids.imdbEnd;
  if (ids.tmdbStart !== undefined) row.tmdb_start = ids.tmdbStart;
  if (ids.tmdbEnd !== undefined) row.tmdb_end = ids.tmdbEnd;
  if (ids.tvdbStart !== undefined) row.tvdb_start = ids.tvdbStart;
  if (ids.tvdbEnd !== undefined) row.tvdb_end = ids.tvdbEnd;

  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'anilist_id' });
  if (error) throw error;
}

// DELETE: unchanged
export async function deleteByAnilistId(anilistId: number): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase.from(TABLE).delete().eq('anilist_id', anilistId);
  if (error) throw error;
}
