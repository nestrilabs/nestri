import { randomInt } from 'node:crypto';

/**
 * The public name a host is reached at: `amber-otter-4821.nestri.link`.
 *
 * Deliberately not the machine's id. Ids here are monotonic, so an id in a
 * hostname discloses roughly when a machine was registered and its order
 * relative to every other machine its owner holds. An id is also the primary
 * key, so a name that has to change — because it was scraped, shared with the
 * wrong person, or simply disliked — could only be changed by re-registering
 * the machine. And because the hostname is also the OAuth audience and the
 * cookie's scope, an id in it travels into redirect URLs, browser history and
 * every access log on the way to the issuer. ref(d-0019)
 *
 * Words rather than random characters because the people who read one of these
 * aloud are operators on a call, and a ten-character string is not something
 * anybody says twice. The digits carry the entropy; the words carry the
 * memorability.
 */
export namespace Slug {
	/**
	 * Concrete, neutral, and short enough to say.
	 *
	 * Curated rather than taken from a dictionary: a generated name is shown to
	 * strangers, so the list is chosen to have no combination that is obscene,
	 * insulting or trademark-adjacent. **Adding a word means re-reading the
	 * pairs it creates**, which is the whole reason this is a list in source
	 * rather than a word file somebody drops in.
	 *
	 * No colour-plus-animal pairing here can read as a person or a slur, which
	 * is the property that matters and the one an alphabetical scan does not
	 * give you.
	 */
	const ADJECTIVES = [
		'amber',
		'ash',
		'autumn',
		'azure',
		'bright',
		'bronze',
		'calm',
		'cedar',
		'clay',
		'copper',
		'coral',
		'crisp',
		'dawn',
		'deep',
		'dusk',
		'ember',
		'fern',
		'flint',
		'frost',
		'gentle',
		'glass',
		'golden',
		'granite',
		'green',
		'harbor',
		'hazel',
		'indigo',
		'iron',
		'ivory',
		'jade',
		'lake',
		'linen',
		'maple',
		'marble',
		'meadow',
		'mellow',
		'mint',
		'misty',
		'north',
		'ochre',
		'olive',
		'onyx',
		'opal',
		'pearl',
		'pine',
		'quartz',
		'quiet',
		'rapid',
		'river',
		'rowan',
		'sable',
		'sage',
		'sandy',
		'scarlet',
		'silver',
		'slate',
		'smooth',
		'snowy',
		'solar',
		'spruce',
		'steady',
		'stone',
		'summer',
		'sunny',
		'teal',
		'tidal',
		'umber',
		'velvet',
		'violet',
		'willow',
		'winter',
		'zinc'
	] as const;

	/** Animals and landscape features. Nothing that names a person or a brand. */
	const NOUNS = [
		'alcove',
		'anchor',
		'aspen',
		'badger',
		'basin',
		'beacon',
		'bison',
		'bluff',
		'brook',
		'canyon',
		'cavern',
		'cedar',
		'cliff',
		'comet',
		'cove',
		'crane',
		'crater',
		'creek',
		'delta',
		'dune',
		'eagle',
		'falcon',
		'fjord',
		'forest',
		'fossil',
		'garden',
		'geyser',
		'glacier',
		'glade',
		'gorge',
		'grotto',
		'harbor',
		'heron',
		'hollow',
		'island',
		'jetty',
		'lagoon',
		'lantern',
		'ledge',
		'lichen',
		'marsh',
		'meadow',
		'mesa',
		'moraine',
		'orchard',
		'otter',
		'pebble',
		'pelican',
		'plateau',
		'prairie',
		'puffin',
		'quarry',
		'rapids',
		'raven',
		'reef',
		'ridge',
		'sparrow',
		'spring',
		'summit',
		'thicket',
		'thistle',
		'tundra',
		'valley',
		'willow'
	] as const;

	/**
	 * Labels the fleet's own infrastructure answers on, which nothing may mint.
	 *
	 * The edge publishes its own endpoint id at `edge.<zone>`, and every host in
	 * the fleet reads that name to learn which peer it will accept. A machine
	 * minted onto it would take that path away from every host at once — so
	 * these are refused at mint time rather than filtered per request, because
	 * a request-time filter leaves the bad row in the database.
	 */
	const RESERVED = new Set([
		'edge',
		'api',
		'auth',
		'www',
		'admin',
		'internal',
		'status',
		'assets',
		'static',
		'cdn',
		'mail',
		'ns1',
		'ns2'
	]);

	/** `amber-otter-4821` — two words and four digits, lowercase. */
	export const PATTERN = /^[a-z]+-[a-z]+-\d{4}$/;

	/**
	 * How many distinct names exist: roughly 46 million.
	 *
	 * Worth stating because it is what makes minting a retry rather than a
	 * search. At a thousand machines the chance any one attempt collides is
	 * under one in forty thousand, so the loop below effectively never turns.
	 */
	export const SPACE = ADJECTIVES.length * NOUNS.length * 10_000;

	/**
	 * A name, or a different one if the first is reserved.
	 *
	 * `randomInt` rather than `Math.random`: these are public identifiers, and
	 * a predictable sequence would let somebody who has seen one name guess the
	 * next machine's before its owner does.
	 */
	export function generate(): string {
		for (;;) {
			const adjective = ADJECTIVES[randomInt(ADJECTIVES.length)]!;
			const noun = NOUNS[randomInt(NOUNS.length)]!;
			const digits = randomInt(10_000).toString().padStart(4, '0');
			const slug = `${adjective}-${noun}-${digits}`;
			// A reserved word can only appear as the whole label, and the whole
			// label is never one word — but the check is on the parts as well,
			// so that shortening the pattern later cannot quietly re-open this.
			if (!RESERVED.has(slug) && !RESERVED.has(adjective) && !RESERVED.has(noun)) {
				return slug;
			}
		}
	}

	/** Whether a name is one this control plane would have minted. */
	export function isValid(slug: string): boolean {
		return PATTERN.test(slug) && !RESERVED.has(slug);
	}

	export function isReserved(slug: string): boolean {
		return RESERVED.has(slug.trim().toLowerCase());
	}
}
