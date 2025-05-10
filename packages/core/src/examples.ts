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
        id: "74839300282033",// Primary key
        userID: User.id,// | null  FK to User (null if not linked)
        name: "JD The 65th",
        username: "jdoe",
        realName: "John Doe",
        steamMemberSince: new Date("2010-01-26T21:00:00.000Z"),
        avatarHash: "3a5e805fd4c1e04e26a97af0b9c6fab2dee91a19",
        accountStatus: "new" as const, //active or pending
        limitations: {
            isLimited: false,
            tradeBanState: "none" as const,
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

    export const Friend = {
        ...Examples.SteamAccount,
        user: Examples.User
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

    export const BaseGame = {
        id: "1809540",
        slug: "nine-sols",
        name: "Nine Sols",
        controllerSupport: "full",
        releaseDate: new Date("2024-05-29T06:53:24.000Z"),
        compatibility: "high" as const,
        size: {
            downloadSize: 7907568608,//"7.91 GB",
            sizeOnDisk: 13176088178,//"13.18 GB"
        },
        primaryGenre: "Action",
        score: 4.7,
        description: "Nine Sols is a lore rich, hand-drawn 2D action-platformer featuring Sekiro-inspired deflection focused combat. Embark on a journey of eastern fantasy, explore the land once home to an ancient alien race, and follow a vengeful hero’s quest to slay the 9 Sols, formidable rulers of this forsaken realm.",
    }

    export const Categories = {
        genres: [
            {
                name: "Action",
                slug: "action"
            },
            {
                name: "Adventure",
                slug: "adventure"
            },
            {
                name: "Indie",
                slug: "indie"
            }
        ],
        tags: [
            {
                name: "Metroidvania",
                slug: "metroidvania",
            },
            {
                name: "Souls-like",
                slug: "souls-like",
            },
            {
                name: "Difficult",
                slug: "difficult",
            },
        ],
        developers: [
            {
                name: "RedCandleGames",
                slug: "redcandlegames"
            }
        ],
        publishers: [
            {
                name: "RedCandleGames",
                slug: "redcandlegames"
            }
        ],
    }

    export const Game = {
        ...BaseGame,
        ...Categories
    }

    // export const image = {
    //     type: "screenshot" as const, // or square, vertical, horizontal, movie
    //     hash: "3a5e805fd4c1e04e26a97af0b9c6fab2dee91a19",
    //     gameID: Game.id,
    //     extractedColors: [{}]
    // }


}