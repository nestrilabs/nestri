import z from 'zod';

import { Rooms } from '../billing/rooms.js';
import { Env } from '../env.js';
import { fn } from '../fn.js';
import { Machine } from '../machine/index.js';
import { Placement } from './placement.js';

/**
 * Where a room can go: one GPU each. A person's own are listed one by one;
 * the fleet's are grouped by model, because which machine serves a model is
 * placement's choice and not theirs.
 */
export namespace Location {
	export const Own = z
		.object({
			machineId: z.string().meta({ description: 'The host the card is in' }),
			pciId: z.string().meta({ description: 'vendor:device, as the host reported it' }),
			model: z.string().meta({ description: 'What the card is called' }),
			vramMib: z.number().int().nullable().meta({ description: 'Card memory in MiB, if reported' }),
			online: z.boolean().meta({ description: 'Whether its host is reporting in' })
		})
		.meta({ ref: 'OwnLocation' });

	export const Fleet = z
		.object({
			model: z.string().meta({ description: 'The card, as a person recognises it' }),
			vramMib: z.number().int().nullable().meta({ description: 'Card memory in MiB, if reported' }),
			available: z.boolean().meta({ description: 'Whether one is free to put a room on now' }),
			entry: z.boolean().meta({
				description: 'Whether this is an entry model, open to every plan'
			}),
			allowed: z.boolean().meta({ description: 'Whether your plan may create a room on it' })
		})
		.meta({ ref: 'FleetLocation' });

	export const Info = z.object({ own: z.array(Own), fleet: z.array(Fleet) }).meta({
		ref: 'Locations',
		description: 'Every GPU a room could be created on'
	});

	export type Info = z.infer<typeof Info>;

	export const list = fn(
		z.object({ userId: z.string(), plan: z.string().nullable().optional() }),
		async (input): Promise<Info> => {
			const own = (await Machine.listByOwner(input.userId)).flatMap((m) =>
				(m.gpus ?? []).map((g) => ({
					machineId: m.id,
					pciId: g.pciId,
					model: g.model,
					vramMib: g.vramMib ?? null,
					online: Machine.isOnline(m.lastSeen ?? null)
				}))
			);

			const organisationId = Env.get().FLEET_ORGANISATION_ID;
			const byModel = new Map<string, Info['fleet'][number]>();
			if (organisationId) {
				for (const card of await Placement.fleetCards(organisationId)) {
					const seen = byModel.get(card.model);
					byModel.set(card.model, {
						model: card.model,
						vramMib: Math.max(seen?.vramMib ?? 0, card.vramMib ?? 0) || null,
						available: (seen?.available ?? false) || card.free,
						entry: Rooms.isEntry(card.model),
						allowed: Rooms.mayUseModel(input.plan, card.model)
					});
				}
			}
			return {
				own,
				fleet: [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model))
			};
		}
	);
}
