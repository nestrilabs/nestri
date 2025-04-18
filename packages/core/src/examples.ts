import { prefixes } from "./utils";
export namespace Examples {
    export const Id = (prefix: keyof typeof prefixes) =>
        `${prefixes[prefix]}_XXXXXXXXXXXXXXXXXXXXXXXXX`;

    export const Steam = {
        id: Id("steam"),
        userID: Id("user"),
        countryCode: "KE",
        steamID: 74839300282033,
        limitation: {
            isLimited: false,
            isBanned: false,
            isLocked: false,
            isAllowedToInviteFriends: false,
        },
        lastGame: {
            gameID: 2531310,
            gameName: "The Last of Us™ Part II Remastered",
        },
        personaName: "John",
        username: "johnsteamaccount",
        steamEmail: "john@example.com",
        avatarUrl: "https://avatars.akamai.steamstatic.com/XXXXXXXXXXXX_full.jpg",
    }

    export const User = {
        id: Id("user"),
        name: "John Doe",
        email: "john@example.com",
        discriminator: 47,
        avatarUrl: "https://cdn.discordapp.com/avatars/xxxxxxx/xxxxxxx.png",
        polarCustomerID: "0bfcb712-df13-4454-81a8-fbee66eddca4",
        steamAccounts: [Steam]
    };

    export const game = {
        id: Id("game")
    }

    export const session = {
        id: Id("session")
    }

    export const Usage = {
        id: Id("usage"),
        creditsUsed: 20,
        type: "gpu" as const, //or bandwidth, storage
        game: [game],
        session: [session]
    }

    export const Product = {
        id: Id("product"),
        name: "RTX 4090",
        description: "Ideal for dedicated gamers who crave more flexibility and social gaming experiences.",
        tokensPerHour: 20,
    }

    export const Subscription = {
        tokens: 100,
        id: Id("subscription"),
        userID: Id("user"),
        teamID: Id("team"),
        planType: "pro" as const, // free, pro, family, enterprise
        standing: "new" as const, // new, good, overdue, cancelled
        polarProductID: "0bfcb712-df13-4454-81a8-fbee66eddca4",
        polarSubscriptionID: "0bfcb712-df13-4454-81a8-fbee66eddca4",
    }

    export const Member = {
        id: Id("member"),
        email: "john@example.com",
        teamID: Id("team"),
        role: "admin" as const,
        timeSeen: new Date("2025-02-23T13:39:52.249Z"),
    }

    export const Team = {
        id: Id("team"),
        name: "John Does' Team",
        slug: "john_doe",
        subscriptions: [Subscription],
        members: [Member]
    }

    export const Machine = {
        id: Id("machine"),
        userID: Id("user"),
        country: "Kenya",
        countryCode: "KE",
        timezone: "Africa/Nairobi",
        location: { latitude: 36.81550, longitude: -1.28410 },
        fingerprint: "fc27f428f9ca47d4b41b707ae0c62090",
    }

}