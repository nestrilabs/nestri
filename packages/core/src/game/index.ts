import { z } from "zod";
import { fn } from "../utils";
import { Examples } from "../examples";
import { eq, and, isNull } from "drizzle-orm"
import { createSelectSchema } from "drizzle-zod";
import { pipe, groupBy, values, map } from "remeda";
import { useTransaction } from "../drizzle/transaction";
import { Achievements, Company, gameGenreRelationTable, gameGenreTable, gameTable, Pegi, SystemRequirements } from "./game.sql";


export namespace Game {
    const GenreInfo = createSelectSchema(gameGenreTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })

    export const Info = z
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

    export type Info = z.infer<typeof Info>;
    type GenreInfo = z.infer<typeof GenreInfo>;

    export const fromAppID = fn(
        Info.pick({ appID: true }),
        (input) =>
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
                            eq(gameTable.appID, input.appID),
                            isNull(gameTable.timeDeleted)
                        )
                    )
                    .then((rows => serialize(rows).at(0)))
            )
    )

    export function serialize(
        input: { game: typeof gameTable.$inferSelect; genres: typeof gameGenreTable.$inferSelect }[],
    ): z.infer<typeof Info>[] {
        return pipe(
            input,
            groupBy((row) => row.game.appID.toString()),
            values(),
            map((group) => ({
                pegi: group[0].game.pegi,
                name: group[0].game.name,
                appID: group[0].game.appID,
                isFree: group[0].game.isFree,
                website: group[0].game.website,
                reviews: group[0].game.reviews,
                developers: group[0].game.developers,
                publishers: group[0].game.publishers,
                legalNotice: group[0].game.legalNotice,
                description: group[0].game.description,
                releaseDate: group[0].game.releaseDate,
                nativeLinux: group[0].game.nativeLinux,
                achievements: group[0].game.achievements,
                isSinglePlayer: group[0].game.isSinglePlayer,
                controllerSupport: group[0].game.controllerSupport,
                supportsSteamCloud: group[0].game.supportsSteamCloud,
                protonCompatibility: group[0].game.protonCompatibility,
                supportsFamilySharing: group[0].game.supportsFamilySharing,
                systemRequirements: group[0].game.systemRequirements,
                genres: !group[0].genres ?
                    [] :
                    group.map((row) => ({
                        id: row.genres.id,
                        name: row.genres.name
                    })),
            }))
        )
    }
}