import { z } from "zod";
import { Team } from "../team";
import { bus } from "sst/aws/bus";
import { Steam } from "../steam";
import { Common } from "../common";
import { Polar } from "../polar/index";
import { createID, fn } from "../utils";
import { userTable } from "./user.sql";
import { createEvent } from "../event";
import { Examples } from "../examples";
import { Resource } from "sst/resource";
import { teamTable } from "../team/team.sql";
import { steamTable } from "../steam/steam.sql";
import { assertActor, withActor } from "../actor";
import { memberTable } from "../member/member.sql";
import { pipe, groupBy, values, map } from "remeda";
import { and, eq, isNull, asc, sql } from "../drizzle";
import { subscriptionTable } from "../subscription/subscription.sql";
import { afterTx, createTransaction, useTransaction } from "../drizzle/transaction";


export namespace User {
    const MAX_ATTEMPTS = 50;

    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.User.id,
            }),
            name: z.string().openapi({
                description: "The user's unique username",
                example: Examples.User.name,
            }),
            polarCustomerID: z.string().or(z.null()).openapi({
                description: "The polar customer id for this user",
                example: Examples.User.polarCustomerID,
            }),
            email: z.string().openapi({
                description: "The email address of this user",
                example: Examples.User.email,
            }),
            avatarUrl: z.string().or(z.null()).openapi({
                description: "The url to the profile picture.",
                example: Examples.User.name,
            }),
            discriminator: z.string().or(z.number()).openapi({
                description: "The (number) discriminator for this user",
                example: Examples.User.discriminator,
            }),
            steamAccounts: Steam.Info.array().openapi({
                description: "The steam accounts for this user",
                example: Examples.User.steamAccounts,
            }),
        })
        .openapi({
            ref: "User",
            description: "Represents a user on Nestri",
            example: Examples.User,
        });

    export type Info = z.infer<typeof Info>;

    export const Events = {
        Created: createEvent(
            "user.created",
            z.object({
                userID: Info.shape.id,
            }),
        ),
        Updated: createEvent(
            "user.updated",
            z.object({
                userID: Info.shape.id,
            }),
        ),
    };

    export const sanitizeUsername = (username: string): string => {
        // Remove spaces and numbers
        return username.replace(/[\s0-9]/g, '');
    };

    export const generateDiscriminator = (): string => {
        return Math.floor(Math.random() * 100).toString().padStart(2, '0');
    };

    export const isValidDiscriminator = (discriminator: string): boolean => {
        return /^\d{2}$/.test(discriminator);
    };

    export const findAvailableDiscriminator = fn(z.string(), async (input) => {
        const username = sanitizeUsername(input);

        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            const discriminator = generateDiscriminator();

            const users = await useTransaction(async (tx) =>
                tx
                    .select()
                    .from(userTable)
                    .where(and(eq(userTable.name, username), eq(userTable.discriminator, Number(discriminator))))
            )

            if (users.length === 0) {
                return discriminator;
            }
        }

        return null;
    })

    export const create = fn(Info.omit({ polarCustomerID: true, discriminator: true, steamAccounts: true }).partial({ avatarUrl: true, id: true }), async (input) => {
        const userID = createID("user")

        //FIXME: Do this much later, as Polar.sh has so many inconsistencies for fuck's sake

        const customer = await Polar.fromUserEmail(input.email)
        console.log("customer", customer)

        const name = sanitizeUsername(input.name);

        // Generate a random available discriminator
        const discriminator = await findAvailableDiscriminator(name);

        if (!discriminator) {
            console.error("No available discriminators for this username ")
            return null
        }

        createTransaction(async (tx) => {
            const id = input.id ?? userID;
            await tx.insert(userTable).values({
                id,
                name: input.name,
                avatarUrl: input.avatarUrl,
                email: input.email,
                discriminator: Number(discriminator),
                polarCustomerID: customer?.id
            })
            await afterTx(() =>
                withActor({
                    type: "user",
                    properties: {
                        userID: id,
                        email: input.email
                    },
                },
                    async () => bus.publish(Resource.Bus, Events.Created, { userID: id }),
                )
            );
        })

        return userID;
    })

    export const fromEmail = fn(z.string(), async (email) =>
        useTransaction(async (tx) =>
            tx
                .select()
                .from(userTable)
                .leftJoin(steamTable, eq(userTable.id, steamTable.userID))
                .where(and(eq(userTable.email, email), isNull(userTable.timeDeleted)))
                .orderBy(asc(userTable.timeCreated))
                .then((rows => serialize(rows).at(0)))
        )
    )

    export const fromID = fn(z.string(), (id) =>
        useTransaction(async (tx) =>
            tx
                .select()
                .from(userTable)
                .leftJoin(steamTable, eq(userTable.id, steamTable.userID))
                .where(and(eq(userTable.id, id), isNull(userTable.timeDeleted), isNull(steamTable.timeDeleted)))
                .orderBy(asc(userTable.timeCreated))
                .then((rows) => serialize(rows).at(0))
        ),
    )

    export const remove = fn(Info.shape.id, (id) =>
        useTransaction(async (tx) => {
            await tx
                .update(userTable)
                .set({
                    timeDeleted: sql`now()`,
                })
                .where(and(eq(userTable.id, id)))
                .execute();
            return id;
        }),
    );

    export function serialize(
        input: { user: typeof userTable.$inferSelect; steam: typeof steamTable.$inferSelect | null }[],
    ): z.infer<typeof Info>[] {
        return pipe(
            input,
            groupBy((row) => row.user.id),
            values(),
            map((group) => ({
                ...group[0].user,
                steamAccounts: !group[0].steam ?
                    [] :
                    group.map((row) => ({
                        id: row.steam!.id,
                        lastSeen: row.steam!.lastSeen,
                        countryCode: row.steam!.countryCode,
                        username: row.steam!.username,
                        steamID: row.steam!.steamID,
                        lastGame: row.steam!.lastGame,
                        limitation: row.steam!.limitation,
                        steamEmail: row.steam!.steamEmail,
                        userID: row.steam!.userID,
                        personaName: row.steam!.personaName,
                        avatarUrl: row.steam!.avatarUrl,
                    })),
            })),
        )
    }

    export function teams() {
        const actor = assertActor("user");
        return useTransaction(async (tx) =>
            tx
                .select()
                .from(teamTable)
                .leftJoin(subscriptionTable, eq(subscriptionTable.teamID, teamTable.id))
                .innerJoin(memberTable, eq(memberTable.teamID, teamTable.id))
                .where(
                    and(
                        eq(memberTable.email, actor.properties.email),
                        isNull(memberTable.timeDeleted),
                        isNull(teamTable.timeDeleted),
                    ),
                )
                .execute()
                .then((rows) => Team.serialize(rows))
        )
    }
}