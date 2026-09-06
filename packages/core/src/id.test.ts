import { describe, expect, test } from 'bun:test';

import { Examples } from './examples.js';
import { Identifier } from './id.js';

const prefixes = Object.keys(Identifier.prefixes) as (keyof typeof Identifier.prefixes)[];

describe('an id, the rule for one, and the documented example agree', () => {
	// Three things have to say the same thing and only one of them is the
	// generator. They drifted once already: the example was twenty-nine
	// characters against a rule demanding thirty, so every id in the published
	// documentation was a value the schema beside it would reject. Nothing
	// noticed, because an example is never parsed.

	test('every generated id satisfies its own schema', () => {
		for (const prefix of prefixes) {
			const parsed = Identifier.schema(prefix).safeParse(Identifier.ascending(prefix));
			expect(parsed.success).toBe(true);
		}
	});

	test('every documented example satisfies the schema that publishes it', () => {
		for (const prefix of prefixes) {
			const parsed = Identifier.schema(prefix).safeParse(Examples.Id(prefix));
			expect(parsed.success).toBe(true);
		}
	});

	test('an id is the width the column holds', () => {
		// `ulid()` is `char(26 + 4)`, and a char column refuses an overlong
		// value rather than truncating — so a generator that drifted wider
		// would fail every insert, not merely look wrong.
		for (const prefix of prefixes) {
			expect(Identifier.ascending(prefix)).toHaveLength(30);
			expect(Examples.Id(prefix)).toHaveLength(30);
		}
	});

	test('the schema refuses the near misses, not just the obvious ones', () => {
		const schema = Identifier.schema('user');
		const body = 'a'.repeat(Identifier.LENGTH);
		expect(schema.safeParse(`usr_${body}`).success).toBe(true);
		// One short, one long, right length with the wrong prefix, and the
		// prefix without its separator — which would otherwise read as a user
		// id because it starts with the same three letters.
		expect(schema.safeParse(`usr_${body.slice(1)}`).success).toBe(false);
		expect(schema.safeParse(`usr_${body}a`).success).toBe(false);
		expect(schema.safeParse(`mch_${body}`).success).toBe(false);
		expect(schema.safeParse(`usr${body}a`).success).toBe(false);
	});
});
