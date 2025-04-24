import { prefixes } from "./utils";
export namespace Examples {
    export const Id = (prefix: keyof typeof prefixes) =>
        `${prefixes[prefix]}_XXXXXXXXXXXXXXXXXXXXXXXXX`;

    export const Credential = {
        username: "janedoe",
        steamID: 74839300282033n,
        cookies: ["steamLoginSecure=76561199513230864%7C%7CeyAidHlwIjogIkpXVCIsICJhbGciOiAiRWR", "sessionid=707ddf8a847defeb930f"],
        // Useless JWT as an example
        accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NT...",
        refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NT...",
    }

    export const Steam = {
        // userID: Id("user"),
        steamID: 74839300282033n,
        avatarHash: "3a5e805fd4c1e04e26a97af0b9c6fab2dee91a19",
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
        // steamAccounts: [Steam]
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

    const GameGenre = {
        id: "1",
        name: "Action",
    }

    export const Game = {
        appID: 870780,
        name: "Control Ultimate Edition",
        isFree: false,
        genres: [GameGenre],
        website: "https://controlgame.com",
        legalNotice: "Control © Remedy Entertainment Plc 2019. The Remedy, Northlight and Control logos are trademarks of Remedy Entertainment Plc. 505 Games and the 505 Games logo are trademarks of 505 Games SpA, and may be registered in the United States and other countries. All rights reserved.",
        releaseDate: new Date("27 Aug, 2020"),
        description: "Winner of over 80 awards, Control is a visually stunning third-person action-adventure that will keep you on the edge of your seat.",
        nativeLinux: false,
        achievements: {
            total: 67,
            highlighted: [
                {
                    name: "Choose to be Chosen",
                    path: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/870780/6f0314176c570dfbc06c0f532f59eca4420d09e6.jpg",
                },
                {
                    name: "Altered Manifestations May Occur",
                    path: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/870780/ef4d7d8a40ab441dca81c390a01fd06c1432d6b3.jpg",
                },
                {
                    name: "Aggressive Growth",
                    path: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/870780/22cba86f22c3f3f81373670ee209d23a24398e22.jpg",
                },
                {
                    name: "Head of Communications",
                    path: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/870780/460bed87d0faecea8976f7d8a26267945205a6c9.jpg",
                },
                {
                    name: "Living Archetypes",
                    path: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/870780/74f30622a42f1ae2532c112410af8e46d1aee122.jpg",
                },
                {
                    name: "Astral Phenomena",
                    path: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/870780/a0d35ff27b79a26d7a876009482f998c32525653.jpg",
                },
                {
                    name: "Welcome to the Oldest House",
                    path: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/870780/25bd55f5928e01f0b6b1409c9d061f515a7f96d6.jpg",
                },
                {
                    name: "Unknown Caller ",
                    path: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/870780/7089cd9389ee6daea1c31994318cfe3d0e19401e.jpg",
                },
                {
                    name: "Directorial Override",
                    path: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/870780/3c8769de243a101bf997461019200f004985c7df.jpg",
                },
                {
                    name: "Old Boys' Club",
                    path: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/870780/73120b304431feb51c2e5ba6f9b466d9041d008e.jpg",
                }
            ],
        },
        isSinglePlayer: true,
        supportsSteamCloud: true,
        supportsFamilySharing: true,
        reviews: "“The perfect blend of narrative and gameplay, coherency and strangeness, Control is a game we'll be talking about for generations”<br>4.5 / 5 – GamesRadar+<br><br>“Giddy action and astonishing art design combine in one of the great locations of modern video games”<br>Eurogamer<br><br>“Control is set in an engrossingly weird paranormal world that I couldn’t help but explore”<br>8.8 – IGN<br>",
        pegi: {
            rating: "16",
            description: "Blood\r\nStrong Language\r\nViolence",
            requiredAge: 17
        },
        protonCompatibility: 3,
        controllerSupport: "full",
        systemRequirements: {
            minimum: "<strong>Minimum:</strong><br><ul class=\"bb_ul\"><li>Requires a 64-bit processor and operating system<br></li><li><strong>OS *:</strong> Windows 7, 64-bit<br></li><li><strong>Processor:</strong> Intel Core i5-4690 / AMD FX 4350<br></li><li><strong>Memory:</strong> 8 GB RAM<br></li><li><strong>Graphics:</strong> NVIDIA GeForce GTX 780 / AMD Radeon R9 280X<br></li><li><strong>DirectX:</strong> Version 11<br></li><li><strong>Storage:</strong> 42 GB available space<br></li><li><strong>Additional Notes:</strong> Additional Features: Widescreen support 21:9 / Remappable controls / Uncapped frame-rate / G-Sync / Freesync support</li></ul>",
            recommended: "<strong>Recommended:</strong><br><ul class=\"bb_ul\"><li>Requires a 64-bit processor and operating system<br></li><li><strong>OS:</strong> Windows 10, 64-bit<br></li><li><strong>Processor:</strong> Intel Core i5-7600K / AMD Ryzen 5 1600X<br></li><li><strong>Memory:</strong> 16 GB RAM<br></li><li><strong>Graphics:</strong> NVIDIA GeForce GTX 1660/1060 / AMD Radeon RX 580 AMD | For Ray Tracing: GeForce RTX 2060<br></li><li><strong>DirectX:</strong> Version 12<br></li><li><strong>Storage:</strong> 42 GB available space<br></li><li><strong>Additional Notes:</strong> Additional Features: Widescreen support 21:9 / Remappable controls / Uncapped frame-rate / G-Sync / Freesync support</li></ul>",
        },
        publishers: [{
            name: "Remedy Entertainment",
            url: null,
        }],
        developers: [{
            name: "Remedy Entertainment",
            url: null,
        }],

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