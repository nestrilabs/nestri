import { relations } from "drizzle-orm";
import { userTable } from "../user/user.sql";
import { teamTable } from "../team/team.sql";
import { memberTable } from "../member/member.sql";
import { steamTable } from "../steam/steam.sql";
import { friendTable } from "../friend/friend.sql";
import { steamLibraryTable } from "../library/library.sql";
import { subscriptionTable } from "../subscription/subscription.sql";
import { gameGenreRelationTable, gameGenreTable, gameTable } from "../game/game.sql";

// User relations
export const userRelations = relations(userTable, ({ many }) => ({
    steamAccounts: many(steamTable),
    subscriptions: many(subscriptionTable),
}));

// Team relations
export const teamRelations = relations(teamTable, ({ many }) => ({
    members: many(memberTable),
    subscriptions: many(subscriptionTable)
}));

// Member relations
export const memberRelations = relations(memberTable, ({ one }) => ({
    team: one(teamTable, {
        fields: [memberTable.teamID],
        references: [teamTable.id]
    })
}));

// Subscription relations  
export const subscriptionRelations = relations(subscriptionTable, ({ one }) => ({
    team: one(teamTable, {
        fields: [subscriptionTable.teamID],
        references: [teamTable.id]
    }),
    user: one(userTable, {
        fields: [subscriptionTable.userID], 
        references: [userTable.id]
    })
}));

// Steam account relations
export const steamRelations = relations(steamTable, ({ one, many }) => ({
    user: one(userTable, {
        fields: [steamTable.userID],
        references: [userTable.id]
    }),
    friends: many(friendTable, { relationName: "steam_friends" }),
    friendOf: many(friendTable, { relationName: "friend_of" }),
    library: many(steamLibraryTable)
}));

// Friend relations
export const friendRelations = relations(friendTable, ({ one }) => ({
    steam: one(steamTable, {
        fields: [friendTable.steamID],
        references: [steamTable.steamID],
        relationName: "steam_friends"
    }),
    friend: one(steamTable, {
        fields: [friendTable.friendSteamID],
        references: [steamTable.steamID],
        relationName: "friend_of" 
    })
}));

// Game relations
export const gameRelations = relations(gameTable, ({ many }) => ({
    genres: many(gameGenreRelationTable),
    libraries: many(steamLibraryTable)
}));

// Game genre relations
export const genreRelations = relations(gameGenreTable, ({ many }) => ({
    games: many(gameGenreRelationTable)
}));

// Game-genre relation mapping
export const gameGenreRelationRelations = relations(gameGenreRelationTable, ({ one }) => ({
    game: one(gameTable, {
        fields: [gameGenreRelationTable.gameID],
        references: [gameTable.appID]
    }),
    genre: one(gameGenreTable, {
        fields: [gameGenreRelationTable.genreID],
        references: [gameGenreTable.id]
    })
}));

// Steam library relations
export const steamLibraryRelations = relations(steamLibraryTable, ({ one }) => ({
    steam: one(steamTable, {
        fields: [steamLibraryTable.steamID],
        references: [steamTable.steamID]
    }),
    game: one(gameTable, {
        fields: [steamLibraryTable.gameID],
        references: [gameTable.appID]
    })
}));