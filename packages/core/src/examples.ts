import { prefixes } from "./utils";
export namespace Examples {
    export const Id = (prefix: keyof typeof prefixes) =>
        `${prefixes[prefix]}_XXXXXXXXXXXXXXXXXXXXXXXXX`;

    export const Credential = {
        id: Id("credential"),
        username: "janedoe",
        steamID: 74839300282033n,
        cookies: ["steamLoginSecure=76561199513230864%7C%7CeyAidHlwIjogIkpXVCIsICJhbGciOiAiRWR", "sessionid=707ddf8a847defeb930f"],
        // Useless JWT as an example
        accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NT...",
        refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NT...",
    }

    export const Steam = {
        id: Id("steam"),
        userID: Id("user"),
        steamID: 74839300282033n,
        avatarHash:"3a5e805fd4c1e04e26a97af0b9c6fab2dee91a19",
        personaName: "JD The 65th",
        realName: "John Doe",
        profileUrl: "https://steamcommunity.com/id/XXXXXXXXXXXXXXXX/",
    }

    export const User = {
        id: Id("user"),
        name: "John Doe",
        email: "john@example.com",
        discriminator: 47,
        avatarUrl: "https://cdn.discordapp.com/avatars/XXXXXXXXXX/XXXXXXXXXX.png",
        polarCustomerID: "0bfcb712-df13-4454-81a8-fbee66eddca4",
        steamAccounts: [Steam]
    };

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