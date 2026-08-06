import { char, timestamp as rawTs } from 'drizzle-orm/pg-core';

export const ulid = (name: string) => char(name, { length: 26 + 4 });

export const id = {
	get id() {
		return ulid('id').primaryKey().notNull();
	}
};

export const utc = (name: string) =>
	rawTs(name, {
		withTimezone: true
	});

export const timestamps = {
	timeCreated: utc('time_created').notNull().defaultNow(),
	timeUpdated: utc('time_updated')
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
	timeDeleted: utc('time_deleted')
};
