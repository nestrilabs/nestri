export module Examples {

    export const User = {
        id: "0bfcc712-df13-4454-81a8-fbee66eddca4",
        email: "john@example.com",
    };

    export const Profile = {
        id: "0bfcb712-df13-4454-81a8-fbee66eddca4",
        username: "janedoe47",
        avatarUrl: "https://cdn.discordapp.com/avatars/xxxxxxx/xxxxxxx.png",
        discriminator: 12, //it needs to be two digits
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

    export const Game = {
        id: '0bfcb712-df13-4454-81a8-fbee66eddca4',
        name: "Control Ultimate Edition",
        steamID: 870780,
    }

    export const Session = {
        id: "0bfcb712-df13-4454-81a8-fbee66eddca4",
        public: true,
        name: 'Late night chilling with the squad',
        startedAt: '2025-01-04T11:56:23.902Z',
        endedAt: '2025-01-04T11:56:23.902Z'
    }
}