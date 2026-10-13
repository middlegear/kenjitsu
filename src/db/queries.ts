import { supabase } from './client.js';

const TABLE = 'anime_mappings';

export type Mapping = {
  anilist_id: number;
  tmdb_id: number | null;
  tvdb_id: number | null;
  imdb_id: string | null;
  media_type: string | null;
};

// READ:
export async function getByAnilistId(anilistId: number): Promise<Mapping | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from(TABLE)
    .select('anilist_id, tmdb_id, tvdb_id, imdb_id, media_type')
    .eq('anilist_id', anilistId)
    .maybeSingle<Mapping>();

  if (error) throw error;
  return data;
}

// CREATE / UPDATE:
export async function upsertMapping(
  anilistId: number,
  mediaType?: string,
  ids: { tmdbId?: number; tvdbId?: number; imdbId?: string } = {},
): Promise<void> {
  if (!supabase) return;

  const row: Record<string, unknown> = { anilist_id: anilistId };

  if (mediaType !== undefined) row.media_type = mediaType;
  if (ids.tmdbId !== undefined) row.tmdb_id = ids.tmdbId;
  if (ids.tvdbId !== undefined) row.tvdb_id = ids.tvdbId;
  if (ids.imdbId !== undefined) row.imdb_id = ids.imdbId;

  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'anilist_id' });
  if (error) throw error;
}

// DELETE:
export async function deleteByAnilistId(anilistId: number): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase.from(TABLE).delete().eq('anilist_id', anilistId);
  if (error) throw error;
}
