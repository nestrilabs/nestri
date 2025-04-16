import { prefixes } from "./utils";
export namespace Examples {
    export const Id = (prefix: keyof typeof prefixes) =>
        `${prefixes[prefix]}_XXXXXXXXXXXXXXXXXXXXXXXXX`;

    export const Credential = {
        id: Id("credential"),
        steamID: Id("steam"),
        // Useless JWT as an example
        accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWUsImlhdCI6MTUxNjIzOTAyMn0.KMUFsIDTnFmyG3nMiGM6H9FNFUROf3wh7SmqJp-QV30",
        username: "janedoe"
    }

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
        // credentials: [Credential]
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