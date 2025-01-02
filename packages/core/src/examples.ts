export module Examples {

    export const User = {
        id: "0bfcc712-df13-4454-81a8-fbee66eddca4",
        email: "john@example.com",
    };

    export const Machine = {
        id: "0bfcb712-df13-4454-81a8-fbee66eddca4",
        hostname: "desktopeuo8vsf",
        fingerprint: "fc27f428f9ca47d4b41b70889ae0c62090",
        location: "KE, AF"
    }

    // export const Team = {
    //     id: createID(),
    //     name: "Jane's Family",
    //     type: "Family"
    // }

    // export const ProductVariant = {
    //     id: createID(),
    //     name: "FamilySM",
    //     price: 10,
    // };

    // export const Product = {
    //     id: createID(),
    //     name: "Family",
    //     description: "The ideal subscription tier for dedicated gamers who crave more flexibility and social gaming experiences.",
    //     variants: [ProductVariant],
    //     subscription: "allowed" as const,
    // };

    // export const Subscription = {
    //     id: createID(),
    //     productVariant: ProductVariant,
    //     quantity: 1,
    //     polarOrderID: createID(),
    //     frequency: "monthly" as const,
    //     next: new Date("2024-02-01 19:36:19.000").getTime(),
    //     owner: User
    // };

}