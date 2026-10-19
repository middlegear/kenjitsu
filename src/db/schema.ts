import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const animeMappings = pgTable(
  'anime_mappings',
  {
    anilistId: integer('anilist_id').primaryKey(),

    tmdbId: integer('tmdb_id'),
    tvdbId: integer('tvdb_id'),
    imdbId: text('imdb_id'),
    mediaType: text('media_type'),
    imdbStart: text('imdb_start'),
    imdbEnd: text('imdb_end'),
    tmdbStart: text('tmdb_start'),
    tmdbEnd: text('tmdb_end'),
    tvdbStart: text('tvdb_start'),
    tvdbEnd: text('tvdb_end'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    index('anime_mappings_tmdb_idx').on(table.tmdbId),
    index('anime_mappings_tvdb_idx').on(table.tvdbId),
    index('anime_mappings_imdb_idx').on(table.imdbId),
  ],
);
