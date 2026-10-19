import { Env } from '../env.js';
import { ErrorCodes, VisibleError } from '../error.js';

/**
 * What a plan allows: rooms, and nothing measured in time.
 *
 * A room is a box pinned to one GPU. Cloud rooms (on the fleet's GPUs) are
 * counted against the plan; rooms on a person's own GPUs are never limited.
 */
export namespace Rooms {
	/** Cloud rooms per plan. `paid` is the Pro plan; anything else is free. */
	export const LIMITS = { free: 1, paid: 3 } as const;

	/**
	 * Fleet GPU models a free plan may use, as case-insensitive substrings of the
	 * model name. Overridden by `FLEET_ENTRY_GPUS`, which is what a deploy sets
	 * as the fleet changes.
	 */
	export const DEFAULT_ENTRY_GPUS = ['Radeon Pro V710', 'RTX A2000', 'RTX 3060'];

	export function entryModels(): string[] {
		const raw = Env.get().FLEET_ENTRY_GPUS;
		if (raw === undefined) return DEFAULT_ENTRY_GPUS;
		return raw
			.split(',')
			.map((m) => m.trim())
			.filter(Boolean);
	}

	export function isEntry(model: string): boolean {
		const name = model.toLowerCase();
		return entryModels().some((m) => name.includes(m.toLowerCase()));
	}

	export function isPro(plan: string | null | undefined): boolean {
		return plan === 'paid';
	}

	export function allowed(plan: string | null | undefined): number {
		return isPro(plan) ? LIMITS.paid : LIMITS.free;
	}

	/** Whether a plan may put a room on this fleet model. */
	export function mayUseModel(plan: string | null | undefined, model: string): boolean {
		return isPro(plan) || isEntry(model);
	}

	export function needsPro(model: string): VisibleError {
		return new VisibleError(
			'forbidden',
			ErrorCodes.Permission.GPU_NEEDS_PRO,
			`Upgrade to create a room on ${model}`,
			undefined,
			{ model }
		);
	}

	export function atLimit(model: string | null, plan: string | null | undefined): VisibleError {
		return new VisibleError(
			'forbidden',
			ErrorCodes.Permission.ROOM_LIMIT,
			`Upgrade to create a room on ${model ?? 'a Nestri GPU'}`,
			undefined,
			{ model, allowed: allowed(plan) }
		);
	}
}
