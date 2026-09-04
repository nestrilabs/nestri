import { Actor } from '@nestri/core/actor';
import { Box } from '@nestri/core/box/index';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Examples } from '@nestri/core/examples';
import { Game } from '@nestri/core/game/index';
import { Identifier } from '@nestri/core/id';
import { Session } from '@nestri/core/session/index';
import { LinkedAccount } from '@nestri/core/user/linked-account';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { ErrorResponses, machineOnly, notPublic, Result, validator } from '../utils';

/**
 * Requesting a run, and carrying one out.
 *
 * Two very different callers meet on one resource here. A person asks for a
 * run and then watches it; the host agent is handed the work and reports what
 * happened. The rule that keeps them apart is that an agent may only see or
 * touch a run whose box is placed on its own hardware, and it is enforced in
 * the query rather than by the agent asking for its own work — a host
 * credential is a long-lived secret on hardware in somebody's home, and what
 * one leaking can reach is decided here.
 */
export namespace SessionApi {
	/**
	 * One answer for "no such run" and "not your run".
	 *
	 * Both are the same refusal on purpose: an agent that could tell the
	 * difference could discover which ids exist by reporting states at them.
	 */
	function notYours(): never {
		throw new VisibleError(
			'forbidden',
			ErrorCodes.Permission.FORBIDDEN,
			'No such session, or it is not on this machine'
		);
	}

	function conflict(message: string): never {
		throw new VisibleError('already_exists', ErrorCodes.Validation.INVALID_STATE, message);
	}

	/** The person a run belongs to, refusing a host acting as its owner. */
	function actingPerson(): string {
		const actor = Actor.use();
		if (actor.type !== 'user' && actor.type !== 'member') {
			throw new VisibleError(
				'forbidden',
				ErrorCodes.Permission.INSUFFICIENT_PERMISSIONS,
				'Requesting or reading a session requires a user session'
			);
		}
		return actor.properties.userID;
	}

	const StateReport = z
		.object({
			state: Session.ReportableState.meta({
				description: 'Where the run has got to',
				example: 'starting'
			}),
			errorMessage: z.string().max(1024).nullable().optional().meta({
				description: 'Why it failed. Kept only for a run that did',
				example: Examples.Session.errorMessage
			})
		})
		.strict();

	export const route = new Hono()
		.post(
			'/',
			notPublic,
			describeRoute({
				tags: ['Session'],
				summary: 'Ask for a run of a box',
				description:
					'Creates the run in state `requested`, which is the work order the box’s host picks up. This makes no decision about where the run happens: a box already names the hardware it is placed on, so the run inherits it. Poll the run to watch it start, and re-read its ticket rather than keeping the first one.',
				responses: {
					201: {
						content: { 'application/json': { schema: Result(Session.Info) } },
						description: 'The run has been requested'
					},
					400: ErrorResponses[400],
					401: ErrorResponses[401],
					403: ErrorResponses[403],
					404: ErrorResponses[404],
					409: ErrorResponses[409]
				}
			}),
			validator(
				'json',
				z
					.object({
						boxId: z.string().min(1).meta({
							description: 'The box to run',
							example: Examples.Session.boxId
						}),
						gameId: z.string().min(1).meta({
							description: 'The game to launch',
							example: Examples.Session.gameId
						}),
						linkedAccountId: z.string().min(1).optional().meta({
							description:
								'Which linked account is playing. Defaults to the one the caller signed in with',
							example: Examples.Session.linkedAccountId
						})
					})
					// Strict, so that naming hardware is a validation error rather
					// than a field quietly ignored. There is nothing to choose:
					// asking for a run is not where a box is placed.
					.strict()
			),
			async (c) => {
				const body = c.req.valid('json');
				const userId = actingPerson();

				const box = await Box.fromID(body.boxId);
				if (!box || box.userId !== userId) {
					// Somebody else's box and a box that was never created are the
					// same answer, so ids cannot be probed for.
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						'No such box, or it is not yours'
					);
				}

				const game = await Game.fromID(body.gameId);
				if (!game) {
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						'No such game'
					);
				}

				const actor = Actor.use();
				const linkedAccountId =
					body.linkedAccountId ||
					(actor.type === 'user' ? actor.properties.linkedAccountID : '') ||
					'';
				if (!linkedAccountId) {
					// Which account is playing is the question the "who's playing?"
					// screen asks, and some credentials carry no answer to it. Then
					// the caller has to say.
					throw new VisibleError(
						'validation',
						ErrorCodes.Validation.MISSING_REQUIRED_FIELD,
						'Say which linked account is playing',
						'linkedAccountId'
					);
				}
				const linked = await LinkedAccount.fromID(linkedAccountId);
				if (!linked || linked.userId !== userId) {
					throw new VisibleError(
						'forbidden',
						ErrorCodes.Permission.FORBIDDEN,
						'That account is not linked to you'
					);
				}

				// A box runs one thing at a time. Refusing is the honest answer;
				// starting a second run would leave two rows that both think they
				// own the same hardware.
				//
				// This read is the message, not the guarantee — two callers can
				// both pass it. `Session.request` is refused by a unique index on
				// the same predicate, and answers with the same 409 in the same
				// words, so which one caught it is not visible from here.
				const active = await Session.activeForBox(box.id);
				if (active) {
					conflict(Session.BOX_BUSY);
				}

				const session = await Session.request({
					id: Identifier.ascending('session'),
					boxId: box.id,
					gameId: game.id,
					linkedAccountId
				});
				return c.json({ data: session }, 201);
			}
		)
		.get(
			'/:id',
			notPublic,
			describeRoute({
				tags: ['Session'],
				summary: 'Read a run you asked for',
				description:
					'Poll this while a run starts. The ticket appears part-way through and is republished as addresses are discovered, so re-read it rather than keeping the first one — a client that treats the first ticket as final works on a local network and fails from anywhere else. Once the run reaches a terminal state the ticket is null: stop polling and stop dialling it.',
				responses: {
					200: {
						content: { 'application/json': { schema: Result(Session.Info) } },
						description: 'The run as it stands'
					},
					401: ErrorResponses[401],
					403: ErrorResponses[403],
					404: ErrorResponses[404]
				}
			}),
			validator(
				'param',
				z.object({
					id: z.string().meta({ description: 'The run to read', example: Examples.Session.id })
				})
			),
			async (c) => {
				const session = await Session.forOwner({
					id: c.req.valid('param').id,
					userId: actingPerson()
				});
				if (!session) {
					// Owner-scoped in the query, so somebody else's run and one that
					// never existed answer the same way.
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						'No such session, or it is not yours'
					);
				}
				return c.json({ data: session });
			}
		)
		.post(
			'/:id/state',
			machineOnly,
			describeRoute({
				tags: ['Session'],
				summary: 'Report where a run has got to',
				description:
					'For the host the run’s box is placed on, and no other. Moving a run out of `requested` is the claim, and it is a compare-and-set: exactly one caller can take a given run, and one that loses gets 409. Re-reporting a state already reported is fine and changes nothing, including the timestamps a run is billed on. A transition that does not exist is 409 and the run does not move.',
				responses: {
					200: {
						content: { 'application/json': { schema: Result(Session.Info) } },
						description: 'The run as it stands after the report'
					},
					400: ErrorResponses[400],
					403: ErrorResponses[403],
					409: ErrorResponses[409]
				}
			}),
			validator('param', z.object({ id: z.string() })),
			validator('json', StateReport),
			async (c) => {
				const body = c.req.valid('json');
				const result = await Session.transition({
					id: c.req.valid('param').id,
					machineId: Actor.machineID,
					state: body.state,
					errorMessage: body.errorMessage ?? null
				});

				switch (result.outcome) {
					case 'forbidden':
						notYours();
					case 'illegal':
						conflict(`A run in state ${result.session?.state} cannot become ${body.state}`);
					case 'lost':
						conflict('Another caller moved this run first');
					default:
						// `moved` and `unchanged` are both success. An agent retrying
						// after a lost response must not be told it broke something.
						return c.json({ data: result.session });
				}
			}
		)
		.post(
			'/:id/ticket',
			machineOnly,
			describeRoute({
				tags: ['Session'],
				summary: 'Publish the address a client should connect to',
				description:
					'For the host the run’s box is placed on, and no other. Republish freely: a later ticket is a better address for the same run, not a second run, and the address changes as more of them are discovered. A run that has stopped has no address, so that is 409.',
				responses: {
					200: {
						content: { 'application/json': { schema: Result(Session.Info) } },
						description: 'The ticket is published'
					},
					400: ErrorResponses[400],
					403: ErrorResponses[403],
					409: ErrorResponses[409]
				}
			}),
			validator('param', z.object({ id: z.string() })),
			validator(
				'json',
				z
					.object({
						ticket: z.string().min(1).meta({
							description: 'The current connect ticket',
							example: Examples.Session.ticket
						})
					})
					.strict()
			),
			async (c) => {
				const result = await Session.publishTicket({
					id: c.req.valid('param').id,
					machineId: Actor.machineID,
					ticket: c.req.valid('json').ticket
				});

				switch (result.outcome) {
					case 'forbidden':
						notYours();
					case 'closed':
						conflict('That run has stopped, so it has no address to publish');
					default:
						return c.json({ data: result.session });
				}
			}
		);

	/**
	 * The host agent's side of the same resource, mounted where a host looks
	 * for it: everything a box asks about itself lives under one prefix.
	 */
	export const machineRoute = new Hono().get(
		'/jobs',
		machineOnly,
		describeRoute({
			tags: ['Session'],
			summary: 'Ask for work',
			description:
				'Returns the runs waiting to be started on the calling host, and only those — the host comes from its own credentials and the scope is the query, so a box cannot see work for another. Poll at the cadence the heartbeat hands down. Each job carries its kind, so a second kind of work is an addition rather than a change of shape.',
			responses: {
				200: {
					content: { 'application/json': { schema: Result(z.array(Session.Job)) } },
					description: 'Work waiting for this host, oldest first'
				},
				403: ErrorResponses[403]
			}
		}),
		async (c) => {
			return c.json({ data: await Session.listJobsForMachine(Actor.machineID) });
		}
	);
}
