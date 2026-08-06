import { bigint, integer, jsonb, pgTable, smallint, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, timestamps, utc } from '../db/types.js';

export const GameTable = pgTable(
	'game',
	{
		...id,
		...timestamps,

		steamAppId: integer('steam_app_id').notNull().unique(),
		slug: text('slug').notNull(),
		name: text('name').notNull(),
		type: text('type'),

		clientIcon: text('client_icon'),
		icon: text('icon'),

		shortDescription: text('short_description'),
		description: text('description'),

		developers: jsonb('developers').$type<string[]>(),
		publishers: jsonb('publishers').$type<string[]>(),
		primaryGenre: text('primary_genre'),
		genres: jsonb('genres').$type<string[]>(),
		categories: jsonb('categories').$type<string[]>(),
		oslist: jsonb('oslist').$type<string[]>(),

		sizeDownload: bigint('size_download', { mode: 'number' }),
		sizeOnDisk: bigint('size_on_disk', { mode: 'number' }),

		controllerSupport: text('controller_support'),
		steamDeckCompat: text('steam_deck_compat'),
		reviewScorePercent: smallint('review_score_percent'),
		reviewCount: integer('review_count'),
		metacriticScore: smallint('metacritic_score'),

		steamChangeNumber: integer('steam_change_number'),
		publicBuildId: integer('public_build_id'),
		releaseDate: utc('release_date_utc'),

		timeEnriched: utc('time_enriched')
	},
	(t) => [
		uniqueIndex('game_slug_unique').on(t.slug),
		uniqueIndex('game_app_id_unique').on(t.steamAppId)
	]
);
