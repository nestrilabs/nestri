import { z } from "zod";
import { fn } from "../utils";
import { Examples } from "../examples";
import { eq, and, isNull } from "drizzle-orm"
import { createSelectSchema } from "drizzle-zod";
import { pipe, groupBy, values, map } from "remeda";
import { useTransaction } from "../drizzle/transaction";
import { Achievements, Company, gameGenreTable, gameGenreRelationTable, gameTable, Pegi, SystemRequirements } from "./game.sql";
import { steamTable } from "../steam/steam.sql";
import { useUserID } from "../actor";
import { SteamLibrary } from "../library";


export namespace Game {
    const GenreInfo = createSelectSchema(gameGenreTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })

    export const BasicInfo = z
        .object({
            appID: z.number().openapi({
                description: "Unique Steam application identifier for the game",
                example: Examples.Game.appID
            }),
            name: z.string().openapi({
                description: "Official title of the game on Steam",
                example: Examples.Game.name
            }),
            isFree: z.boolean().openapi({
                description: "Indicates if the game is available for free (true) or requires purchase (false)",
                example: Examples.Game.isFree
            }),
            website: z.string().url().openapi({
                description: "Official website URL for the game",
                example: Examples.Game.website
            }),
            legalNotice: z.string().openapi({
                description: "Copyright and legal information associated with the game",
                example: Examples.Game.legalNotice
            }),
            releaseDate: z.date().openapi({
                description: "Initial publication date of the game on Steam",
                example: Examples.Game.releaseDate
            }),
            description: z.string().openapi({
                description: "Detailed overview of the game's content and features",
                example: Examples.Game.description
            }),
            nativeLinux: z.boolean().openapi({
                description: "Indicates if the game has native Linux support without requiring compatibility layers",
                example: Examples.Game.nativeLinux
            }),
            achievements: Achievements.openapi({
                description: "Collection of unlockable achievements available in the game",
                example: Examples.Game.achievements
            }),
            isSinglePlayer: z.boolean().openapi({
                description: "Indicates if the game offers single-player gameplay mode",
                example: Examples.Game.supportsSteamCloud
            }),
            supportsSteamCloud: z.boolean().openapi({
                description: "Indicates if the game supports Steam Cloud for save data synchronization",
                example: Examples.Game.supportsSteamCloud
            }),
            supportsFamilySharing: z.boolean().openapi({
                description: "Indicates if the game can be shared with family members through Steam Family Sharing",
                example: Examples.Game.supportsFamilySharing
            }),
            reviews: z.string().openapi({
                description: "Aggregated user reviews and ratings from the Steam community",
                example: Examples.Game.reviews
            }),
            pegi: Pegi.openapi({
                description: "Pan European Game Information (PEGI) age rating and content warnings",
                example: Examples.Game.pegi
            }),
            protonCompatibility: z.number().openapi({
                description: "Proton compatibility rating (1: incompatible, 2: partially compatible, 3: fully compatible)",
                example: Examples.Game.protonCompatibility
            }),
            controllerSupport: z.string().openapi({
                description: "Level of game controller compatibility and supported input methods",
                example: Examples.Game.controllerSupport
            }),
            publishers: Company.openapi({
                description: "Companies responsible for publishing and distributing the game",
                example: Examples.Game.publishers
            }),
            developers: Company.openapi({
                description: "Companies and teams responsible for developing the game",
                example: Examples.Game.developers
            }),
            systemRequirements: SystemRequirements.openapi({
                description: "Minimum and recommended hardware/software specifications to run the game",
                example: Examples.Game.systemRequirements
            }),
        })
        .openapi({
            ref: "Steam Game",
            description: "Comprehensive metadata and details about a game available on the Steam platform",
            example: Examples.Game,
        });

    export const FullInfo = BasicInfo
        .extend({
            genres: GenreInfo.array().openapi({
                description: "Genres of this Game",
                example: Examples.Game.genres
            })
        })
        .openapi({
            ref: "Steam Game",
            description: "Comprehensive metadata and details about a game available on the Steam platform",
            example: Examples.Game,
        });

    type GenreInfo = z.infer<typeof GenreInfo>;
    export type FullInfo = z.infer<typeof FullInfo>;
    export type BasicInfo = z.infer<typeof BasicInfo>;

    export const fromAppID = fn(
        BasicInfo.shape.appID,
        (appID) =>
            useTransaction(async (tx) =>
                tx
                    .select({
                        game: gameTable,
                        genres: gameGenreTable
                    })
                    .from(gameTable)
                    .innerJoin(
                        gameGenreRelationTable,
                        eq(gameGenreRelationTable.gameID, gameTable.appID)
                    )
                    .innerJoin(
                        gameGenreTable,
                        eq(gameGenreRelationTable.genreID, gameGenreTable.id)
                    )
                    .where(
                        and(
                            eq(gameTable.appID, appID),
                            isNull(gameTable.timeDeleted)
                        )
                    )
                    .execute()
                    .then((rows => serializeFull(rows).at(0)))
            )
    )

    export function serializeFull(
        input: { game: typeof gameTable.$inferSelect; genres: typeof gameGenreTable.$inferSelect }[],
    ): z.infer<typeof FullInfo>[] {
        return pipe(
            input,
            groupBy((row) => row.game.appID.toString()),
            values(),
            map((group) => ({
                ...serializeBasic(group[0].game),
                genres: !group[0].genres ?
                    [] :
                    group.map((row) => serializeGenre(row.genres!)),
            }))
        )
    }

    export const list = fn(
        z.void(),
        async () =>
            useTransaction(async (tx) => {
                const userSteamAccounts = await tx
                    .select()
                    .from(steamTable)
                    .where(eq(steamTable.userID, useUserID()))
                    .execute();

                if (userSteamAccounts.length === 0) {
                    return []; // User has no steam accounts
                }

                const gamePromises =
                    userSteamAccounts.map(async (steamAccount) => {
                        return SteamLibrary.fromSteamID(steamAccount.steamID)
                    })

                return (await Promise.all(gamePromises)).flat()
            })
    )

    export function serializeBasic(
        input: typeof gameTable.$inferSelect,
    ): z.infer<typeof BasicInfo> {
        return {
            pegi: input.pegi,
            name: input.name,
            appID: input.appID,
            isFree: input.isFree,
            website: input.website,
            reviews: input.reviews,
            developers: input.developers,
            publishers: input.publishers,
            legalNotice: input.legalNotice,
            description: input.description,
            releaseDate: input.releaseDate,
            nativeLinux: input.nativeLinux,
            achievements: input.achievements,
            isSinglePlayer: input.isSinglePlayer,
            controllerSupport: input.controllerSupport,
            supportsSteamCloud: input.supportsSteamCloud,
            protonCompatibility: input.protonCompatibility,
            supportsFamilySharing: input.supportsFamilySharing,
            systemRequirements: input.systemRequirements,
        }
    }

    export function serializeGenre(
        input: typeof gameGenreTable.$inferSelect,
    ): z.infer<typeof GenreInfo> {
        return {
            id: input.id,
            name: input.name
        }
    }
}