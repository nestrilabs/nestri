import { Actor } from '@nestri/core/actor';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Enrolment } from '@nestri/core/steam/enrolment';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { ErrorResponses, machineOnly, Result, validator } from '../utils';

/**
 * What a host reports about the Steam sign-ins it holds.
 *
 * Mounted where a host looks for it — everything a box says about itself lives
 * under one prefix — and machine-authenticated throughout, so the host is
 * taken from its own credentials and never from a body. A box therefore cannot
 * report an enrolment onto somebody else's hardware.
 *
 * **Nothing here accepts a credential**, and that is the point of the shape
 * rather than a property of it. The refresh token, the challenge URL and the
 * client id all stay inside the host process; the bodies below are strict, so
 * a host that tried to send one is told it is wrong instead of being quietly
 * believed. ref(d-0004)
 *
 * Whether a *person* may reach a given box is decided before a request gets
 * here, at the edge, by comparing the team that owns the hardware against the
 * teams they belong to. It is a different question from the one these routes
 * ask, and none of them re-ask it.
 */
export namespace EnrolmentApi {
	// Picked from the domain schema rather than restated, so the shape a host
	// must send and the shape the record has cannot drift apart — including the
	// Steam id's format, which is checked here at the boundary and therefore
	// answers with a validation error rather than a server fault.
	//
	// `.strict()` on both is load-bearing. A body carrying a refresh token, a
	// challenge URL or a client id is a mistake worth refusing loudly:
	// accepting and ignoring it would mean the credential reached this process,
	// was written to the request log, and nobody found out.
	const Reported = Enrolment.Info.pick({ userId: true, steamId: true }).strict();
	const ForOneUser = Enrolment.Info.pick({ userId: true }).strict();

	export const route = new Hono()
		.post(
			'/enrolment',
			machineOnly,
			describeRoute({
				tags: ['Enrolment'],
				summary: 'Say a Steam sign-in completed',
				description:
					'Records that the calling host now holds a Steam refresh token for this user. The host comes from its own credentials. Repeating it is the same fact restated — the Steam account is updated, a previous refusal is cleared, and the time the pairing began is left alone. The token itself is never sent: it belongs on the host that obtained it, and there is no field here that would carry one.',
				responses: {
					200: {
						content: { 'application/json': { schema: Result(Enrolment.Info) } },
						description: 'The enrolment, as it now stands'
					},
					400: ErrorResponses[400],
					403: ErrorResponses[403],
					404: ErrorResponses[404]
				}
			}),
			validator('json', Reported),
			async (c) => {
				const body = c.req.valid('json');
				return c.json({
					data: await Enrolment.record({
						machineId: Actor.machineID,
						userId: body.userId,
						steamId: body.steamId
					})
				});
			}
		)
		.post(
			'/enrolment/stale',
			machineOnly,
			describeRoute({
				tags: ['Enrolment'],
				summary: 'Say Steam refused the token this host holds',
				description:
					'Marks the calling host’s enrolment for this user as stale. Scoped to the caller, so an enrolment belonging to another host is simply not found. An enrolment that was never recorded is a 404 rather than a new stale row — inventing one would make the record claim a sign-in that never happened.',
				responses: {
					200: {
						content: { 'application/json': { schema: Result(Enrolment.Info) } },
						description: 'The enrolment, now stale'
					},
					400: ErrorResponses[400],
					403: ErrorResponses[403],
					404: ErrorResponses[404]
				}
			}),
			validator('json', ForOneUser),
			async (c) => {
				const enrolment = await Enrolment.markStale({
					machineId: Actor.machineID,
					userId: c.req.valid('json').userId
				});
				if (!enrolment) {
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						'This machine has no enrolment for that user'
					);
				}
				return c.json({ data: enrolment });
			}
		)
		.get(
			'/enrolment',
			machineOnly,
			describeRoute({
				tags: ['Enrolment'],
				summary: 'Ask what this host is expected to hold',
				description:
					'Every enrolment recorded against the calling host, oldest first. A host that lost its disk asks this to find out which sign-ins it is believed to have, and can then report the ones it does not. Nothing reconciles the answer yet; the shape is fixed now so it does not change once something depends on it.',
				responses: {
					200: {
						content: { 'application/json': { schema: Result(z.array(Enrolment.Info)) } },
						description: 'Enrolments this host is expected to hold'
					},
					403: ErrorResponses[403]
				}
			}),
			async (c) => {
				return c.json({ data: await Enrolment.listByMachine(Actor.machineID) });
			}
		);
}
