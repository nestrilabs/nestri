import { prefixes } from "./utils";
export module Examples {
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
        personaName: "John",
        username: "johnsteamaccount",
        email: "john@example.com",
        avatarUrl: "https://avatars.akamai.steamstatic.com/XXXXXXXXXXXX_full.jpg",
        country: "KE",
    }

}