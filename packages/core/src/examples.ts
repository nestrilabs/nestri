import { prefixes } from "./utils";

export namespace Examples {
    export const Id = (prefix: keyof typeof prefixes) =>
        `${prefixes[prefix]}_XXXXXXXXXXXXXXXXXXXXXXXXX`;

    export const User = {
        id: Id("user"),// Primary key
        name: "John Doe", // Name (not null)
        email: "johndoe@example.com",// Unique email or login (not null)
        avatarUrl: "https://cdn.discordapp.com/avatars/xxxxxxx/xxxxxxx.png",
        lastLogin: new Date("2025-04-26T20:11:08.155Z"),
        polarCustomerID: "0bfcb712-df13-4454-81a8-fbee66eddca4"
    }

    export const GPUType = {
        id: Id("gpu"),
        type: "hosted" as const, //or BYOG - Bring Your Own GPU
        name: "RTX 4090" as const, // or RTX 3090, Intel Arc
        performanceTier: 3,
        maxResolution: "4k"
    }

    export const Machine = {
        id: Id("machine"),
        ownerID: User.id, //or null if hosted
        gpuID: GPUType.id, // or hosted
        country: "Kenya",
        countryCode: "KE",
        timezone: "Africa/Nairobi",
        location: { latitude: 36.81550, longitude: -1.28410 },
        fingerprint: "fc27f428f9ca47d4b41b707ae0c62090",
    }

    export const SteamAccount = {
        status: "online" as const, //offline,dnd(do not disturb) or playing 
        id: 74839300282033n,// Primary key
        userID: User.id,// | null  FK to User (null if not linked)
        name: "JD The 65th",
        username: "jdoe",
        realName: "John Doe",
        memberSince: new Date("2010-01-26T21:00:00.000Z"),
        avatarHash: "3a5e805fd4c1e04e26a97af0b9c6fab2dee91a19",
        accountStatus: "new" as const, //active or pending
        limitations: {
            isLimited: false,
            isTradeBanned: false,
            isVacBanned: false,
            visibilityState: 3,
            privacyState: "public" as const,
        },
        profileUrl: "The65thJD", //"https://steamcommunity.com/id/XXXXXXXXXXXXXXXX/",
        lastSyncedAt: new Date("2025-04-26T20:11:08.155Z")
    };

    export const Team = {
        id: Id("team"),// Primary key
        name: "John's Console", // Team name (not null, unique)
        ownerID: User.id, // FK to User who owns/created the team
        slug: SteamAccount.profileUrl.toLowerCase(),
        maxMembers: 3,
        inviteCode: "xwydjf",
        members: [SteamAccount]
    };

    export const Member = {
        id: Id("member"),
        userID: User.id,//FK to Users (member)
        steamID: SteamAccount.id, // FK to the Steam Account this member is used
        teamID: Team.id,// FK to Teams
        role: "adult" as const, // Role on the team, adult or child
    };

    export const ProductVariant = {
        id: Id("variant"),
        productID: Id("product"),// the product this variant is under
        type: "fixed" as const, // or yearly or monthly,
        price: 1999,
        minutesPerDay: 3600,
        polarProductID: "0bfcb712-df13-4454-81a8-fbee66eddca4"
    }

    export const Product = {
        id: Id("product"),
        name: "Pro",
        description: "For gamers who want to play on a better GPU and with 2 more friends",
        maxMembers: Team.maxMembers,// Total number of people who can share this sub
        isActive: true,
        order: 2,
        variants: [ProductVariant]
    }

    export const Subscription = {
        id: Id("subscription"),
        teamID: Team.id,
        standing: "active" as const, //incomplete, incomplete_expired, trialing, active, past_due, canceled, unpaid
        ownerID: User.id,
        price: ProductVariant.price,
        productVariantID: ProductVariant.id,
        polarSubscriptionID: "0bfcb712-df13-4454-81a8-fbee66eddca4",
    }

    export const SubscriptionUsage = {
        id: Id("usage"),
        machineID: Machine.id, // machine this session was used on
        memberID: Member.id, // the team member who used it
        subscriptionID: Subscription.id,
        sessionID: Id("session"),
        minutesUsed: 20, // Minutes used on the session
    }

    export const Session = {
        id: Id("session"),
        memberID: Member.id,
        machineID: Machine.id,
        startTime: new Date("2025-02-23T23:39:52.249Z"),
        endTime: null, // null if session is ongoing
        gameID: Id("game"),
        status: "active" as const, // active, completed, crashed
    }

    export const GameGenre = {
        type: "genre" as const,
        slug: "action",
        name: "Action"
    }

    export const GameTag = {
        type: "tag" as const,
        slug: "single-player",
        name: "Single Player"
    }

    export const GameRating = {
        body: "ESRB" as const, // or PEGI
        age: 16,
        descriptors: ["Blood", "Violence", "Strong Language"],
    }

    export const DevelopmentTeam = {
        type: "developer" as const,
        name: "Remedy Entertainment",
        slug: "remedy_entertainment",
    }

    export const Game = {
        id: Id("game"),
        appID: 870780,
        name: "Control Ultimate Edition",
        slug: "control-ultimate-edition",
        tags: [GameTag], // Examples; Multiplayer, Family Sharing, Free To Play, Full Controller Support, In Game Purchases, Native Linux, Proton Compatibility Max (3), Proton Compatibility Mid (2), Proton Compatibility Low (1)
        genres: [GameGenre], // Examples; Action, Adventure,
        website: "https://controlgame.com",
        legalNotice: "Control © Remedy Entertainment Plc 2019. The Remedy, Northlight and Control logos are trademarks of Remedy Entertainment Plc. 505 Games and the 505 Games logo are trademarks of 505 Games SpA, and may be registered in the United States and other countries. All rights reserved.",
        releaseDate: new Date("27 Aug, 2020"),
        description: "Winner of over 80 awards, Control is a visually stunning third-person action-adventure that will keep you on the edge of your seat.",
        ratings: [GameRating],
        publishers: [{ ...DevelopmentTeam, type: "publisher" as const }],
        developers: [DevelopmentTeam],
    }

    export const image = {
        type: "screenshot" as const, // or square, vertical, horizontal, movie
        hash: "3a5e805fd4c1e04e26a97af0b9c6fab2dee91a19",
        gameID: Game.id,
        extractedColors: [{}]
    }

    // export const Machine = {
    //     id: Id("machine"),
    //     userID: Id("user"),
    //     country: "Kenya",
    //     countryCode: "KE",
    //     timezone: "Africa/Nairobi",
    //     location: { latitude: 36.81550, longitude: -1.28410 },
    //     fingerprint: "fc27f428f9ca47d4b41b707ae0c62090",
    // }
}