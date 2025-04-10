import { prefixes } from "./utils";
export namespace Examples {
    export const Id = (prefix: keyof typeof prefixes) =>
        `${prefixes[prefix]}_XXXXXXXXXXXXXXXXXXXXXXXXX`;

    export const User = {
        id: Id("user"),
        name: "John Doe",
        email: "john@example.com",
        discriminator: 47,
        avatarUrl: "https://cdn.discordapp.com/avatars/xxxxxxx/xxxxxxx.png",
        polarCustomerID: "0bfcb712-df13-4454-81a8-fbee66eddca4",
    };

    export const Team = {
        id: Id("team"),
        name: "John Does' Team",
        slug: "john_doe",
        planType: "BYOG" as const
    }

    export const Member = {
        id: Id("member"),
        email: "john@example.com",
        teamID: Id("team"),
        timeSeen: new Date("2025-02-23T13:39:52.249Z"),
    }

    export const Polar = {
        teamID: Id("team"),
        timeSeen: new Date("2025-02-23T13:39:52.249Z"),
    }

    export const Steam = {
        id: Id("steam"),
        userID: Id("user"),
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
        email: "john@example.com",
        steamEmail: "john@example.com",
        avatarUrl: "https://avatars.akamai.steamstatic.com/XXXXXXXXXXXX_full.jpg",
        countryCode: "KE",
    }

    export const Machine = {
        id: Id("machine"),
        country: "Kenya",
        countryCode: "KE",
        timezone: "Africa/Nairobi",
        location: { latitude: 36.81550, longitude: -1.28410 },
        fingerprint: "fc27f428f9ca47d4b41b707ae0c62090",
    }

}