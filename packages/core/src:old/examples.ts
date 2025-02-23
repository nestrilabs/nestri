export module Examples {

    export const User = {
        id: "0bfcc712-df13-4454-81a8-fbee66eddca4",
        email: "john@example.com",
    };

    export const Task = {
        id: "0bfcc712-df13-4454-81a8-fbee66eddca4",
        taskID: "b8302fca2d224d91ab342a2e4ab926d3",
        type: "AWS" as const, //or "on-premises",
        lastStatus: "RUNNING" as const,
        healthStatus: "UNKNOWN" as const,
        startedAt: '2025-01-09T01:56:23.902Z',
        lastUpdated: '2025-01-09T01:56:23.902Z',
        stoppedAt: '2025-01-09T04:46:23.902Z'
    }

    export const Profile = {
        id: "0bfcb712-df13-4454-81a8-fbee66eddca4",
        username: "janedoe47",
        status: "active" as const,
        avatarUrl: "https://cdn.discordapp.com/avatars/xxxxxxx/xxxxxxx.png",
        discriminator: 12, //it needs to be two digits
        createdAt: '2025-01-04T11:56:23.902Z',
        updatedAt: '2025-01-09T01:56:23.902Z'
    }

    export const Subscription = {
        id: "0bfcb712-df13-4454-81a8-fbee66eddca4",
        checkoutID: "0bfcb712-df43-4454-81a8-fbee66eddca4",
        // productID: "0bfcb712-df43-4454-81a8-fbee66eddca4",
        // quantity: 1,
        // frequency: "monthly" as const,
        // next: '2025-01-09T01:56:23.902Z',
        canceledAt: '2025-02-09T01:56:23.902Z'
    }

    export const Team = {
        id: "0bfcb712-df13-4454-81a8-fbee66eddca4",
        // owner: true,
        name: "Jane Doe's Games",
        slug: "jane-does-games",
        createdAt: '2025-01-04T11:56:23.902Z',
        updatedAt: '2025-01-09T01:56:23.902Z'
    }

    export const Machine = {
        id: "0bfcb712-df13-4454-81a8-fbee66eddca4",
        hostname: "DESKTOP-EUO8VSF",
        fingerprint: "fc27f428f9ca47d4b41b70889ae0c62090",
        createdAt: '2025-01-04T11:56:23.902Z',
        deletedAt: '2025-01-09T01:56:23.902Z'
    }

    export const Instance = {
        id: "0bfcb712-df13-4454-81a8-fbee66eddca4",
        hostname: "a955e059f05d",
        createdAt: '2025-01-04T11:56:23.902Z',
        lastActive: '2025-01-09T01:56:23.902Z'
    }

    export const Game = {
        id: '0bfcb712-df13-4454-81a8-fbee66eddca4',
        name: "Control Ultimate Edition",
        steamID: 870780,
    }

    export const Session = {
        id: "0bfcb712-df13-4454-81a8-fbee66eddca4",
        public: true,
        startedAt: '2025-01-04T11:56:23.902Z',
        endedAt: '2025-01-04T12:36:23.902Z'
    }
}