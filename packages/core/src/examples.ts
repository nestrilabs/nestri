import { Identifier } from './id.js';

export namespace Examples {
	export const Id = (prefix: keyof typeof Identifier.prefixes) =>
		`${Identifier.prefixes[prefix]}_XXXXXXXXXXXXXXXXXXXXXXXXX`;

	export const User = {
		id: Id('user'),
		name: 'John Doe',
		email: 'johndoe@example.com',
		emailVerified: true,
		image: 'https://cdn.discordapp.com/avatars/xxxxxxx/xxxxxxx.png'
	};

	export const LinkedAccount = {
		id: Id('linkedAccount'),
		userId: Id('user'),
		provider: 'steam',
		providerAccountId: '76561197960287930',
		profile: { personaname: 'John Doe', avatarfull: 'https://avatars.steamstatic.com/xxxx.jpg' }
	};

	export const Team = {
		id: Id('team'),
		name: 'The A Team',
		slug: 'the-a-team',
		ownerId: Id('user'),
		billingEmail: 'billing@example.com',
		plan: 'free',
		subscriptionStatus: 'active',
		metadata: null
	};

	export const Member = {
		id: Id('teamMember'),
		teamId: Id('team'),
		userId: Id('user'),
		role: 'owner' as const
	};

	export const Fingerprint = {
		id: Id('userFingerprint'),
		userId: Id('user'),
		fingerprint: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
		name: 'MacBook Air',
		lastSeen: '2026-07-28T12:00:00.000Z'
	};

	export const PairingCode = {
		id: Id('pairingCode'),
		code: 'NESSH-7F2Q',
		targetUserId: Id('user'),
		newFingerprint: null,
		expiresAt: '2026-07-28T12:10:00.000Z',
		claimedAt: null,
		isClaimed: false
	};

	export const Game = {
		id: Id('game'),
		steamAppId: 730,
		slug: 'counter-strike-2',
		name: 'Counter-Strike 2',
		type: 'game',
		clientIcon: '5aad412d01a9b91ba0379f0b35f4eb0b69d9db08',
		icon: 'f92b09dab91f1d1738f72fe0dd9be18dcc2901f9',
		shortDescription: 'For 25 years...',
		description: 'For over two decades...',
		developers: ['Valve'],
		publishers: ['Valve'],
		primaryGenre: 'Action',
		genres: ['Action', 'FPS'],
		categories: ['Multi-player', 'Steam Achievements'],
		oslist: ['windows', 'linux'],
		sizeDownload: 35000000000,
		sizeOnDisk: 40000000000,
		controllerSupport: 'partial',
		steamDeckCompat: 'perfect',
		reviewScorePercent: 86,
		reviewCount: 1500000,
		metacriticScore: 89,
		steamChangeNumber: 24605165,
		publicBuildId: 12345678,
		releaseDate: '2012-08-21T00:00:00.000Z',
		timeEnriched: '2026-07-29T12:00:00.000Z'
	};

	export const Library = {
		id: Id('userLibrary'),
		userId: Id('user'),
		gameId: Id('game'),
		playtime2w: 3600,
		playtimeForever: 150000,
		lastPlayed: '2026-07-28T12:00:00.000Z'
	};

	export const Depot = {
		id: Id('gameDepot'),
		gameId: Id('game'),
		depotId: 731,
		branch: 'public',
		steamManifestId: '3183503801510301321',
		steamBuildId: 12345678,
		installedManifestId: '3183503801510301321',
		installedBuildId: 12345678,
		sizeDownload: 1000,
		sizeOnDisk: 2000,
		status: 'complete' as const,
		errorMessage: null,
		oslist: 'linux'
	};

	export const AccessToken = {
		id: Id('accessToken'),
		ownerUserId: Id('user'),
		teamId: null,
		name: 'living-room-box',
		expiresAt: null,
		lastUsed: '2026-07-28T12:00:00.000Z'
	};

	export const Machine = {
		id: Id('machine'),
		ownerUserId: Id('user'),
		teamId: null,
		label: 'living-room-box',
		lastSeen: '2026-07-28T12:00:00.000Z'
	};

	export const GameDownload = {
		id: Id('gameDownload'),
		hostId: Id('machine'),
		gameId: Id('game'),
		status: 'downloading' as const,
		progressBytes: 1073741824,
		totalBytes: 5000000000,
		timeStarted: '2026-07-28T12:00:00.000Z',
		timeCompleted: null,
		errorMessage: null
	};
}
