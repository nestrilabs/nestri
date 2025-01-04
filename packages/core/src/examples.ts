export module Examples {

    export const User = {
        id: "0bfcc712-df13-4454-81a8-fbee66eddca4",
        email: "john@example.com",
    };

    export const Location = {
        id: "0bfcb712-df13-4454-81a8-fbee66eddca4",
        country: 'KE',
        continent: 'AF',
        timeZone: 'Africa/Nairobi'
    }

    export const Status = {
        id: "0bfcb712-df13-4454-81a8-fbee66eddca4",
        name: 'initializing', //'running'|'idle'|'terminated'|'error'
        description: 'The machine is initializing and preparing the game for you to play'
    }

    export const Machine = {
        id: "0bfcb712-df13-4454-81a8-fbee66eddca4",
        hostname: "desktopeuo8vsf",
        status: Status,
        fingerprint: "fc27f428f9ca47d4b41b70889ae0c62090",
        location: Location
    }

    export const Genre = {
        id: "0bfcb712-df13-4454-81a8-fbee66eddca4",
        name: 'Adventure'//'Shooter', 'Indie', 'RPG'
    }

    export const OperatingSystem = {
        id: '0bfcb712-df13-4454-81a8-fbee66eddca4',
        name: 'Windows' //'Linux'
    }

    export const EsrbAgeRating = {
        id: '0bfcb712-df13-4454-81a8-fbee66eddca4',
        name: 'E', //T,RP,M,EC,AO
        description: 'Titles rated E (Everyone) have content that is generally suitable for all ages. May contain minimal cartoon, fantasy or mild violence and/or infrequent use of mild language.'
    }

    export const AgeRatingDescriptors = {
        id: '0bfcb722-df13-4454-81a8-fbee66eddca4',
        name: 'Violence', //Blood, Strong Language
        description: 'Scenes involving aggressive conflict. May contain bloodless dismemberment'
    }

    export const Game = {
        id: '0bfcb712-df13-4454-81a8-fbee66eddca4',
        name: 'Control Ultimate Edition',
        url: '/games/control-ultimate-edition',
        steamID: 870780,
        description: {
            short: "Winner of over 80 awards",
            long: "Winner of over 80 awards, Control is a visually stunning third-person action-adventure that will keep you on the edge of your seat.",
        },
        protonCompatibility: 2,
        genre: [Genre],
        controllerSupport: 'full',
        size: 8030,
        operatingSystems: [OperatingSystem],
        images: {
            icon: '/icons/control-ultimate-edition-4454.jpg',
            logo: '/logos/control-ultimate-edition-4454.jpg',
            pane: '/panes/control-ultimate-edition-4454.jpg', //600x900
            square: '/squares/control-ultimate-edition-4454.jpg',
            header: '/headers/control-ultimate-edition-4454.jpg', //460x215
            background: '/backgrounds/control-ultimate-edition-4454.jpg',
        },
        esrbAgeRating: EsrbAgeRating,
        ageRatingDescriptors: [AgeRatingDescriptors],
    }

    export const Session = {
        id: "0bfcb712-df13-4454-81a8-fbee66eddca4",
        createdAt: 1735948357762,
        game: Game,
        url: '/play/0bfcb712',
        public: true,
        status: Status,
        resolution: '1080x1920',
        framerate: 60,
        machine: Machine,
    }
}