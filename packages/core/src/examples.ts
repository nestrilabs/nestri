import { prefixes } from "./utils";
export module Examples {
    export const Id = (prefix: keyof typeof prefixes) =>
        `${prefixes[prefix]}_XXXXXXXXXXXXXXXXXXXXXXXXX`;

    export const User = {
        id: "e7c432f2-2f00-423a-8cec-c4179c2aab8a",
        email: "john@example.com",
    };

    export const Machine = {
        id: Id("machine"),
        name: "Main machine",
        fingerprint: "183ded44-24d0-480e-9908-c022eff8d111",
    }

    export const Team = {
        id: Id("team"),
        name: "Jane's Family",
        type: "Family"
    }

    export const ProductVariant = {
        id: Id("productVariant"),
        name: "FamilySM",
        price: 10,
      };

      export const Product = {
        id: Id("product"),
        name: "Family",
        description:"The ideal subscription tier for dedicated gamers who crave more flexibility and social gaming experiences.",
        variants: [ProductVariant],
        subscription: "allowed" as const,
      };

    export const Subscription = {
        id: Id("subscription"),
        productVariantID: ProductVariant.id,
        quantity: 1,
        polarOrderID: "00000000-0000-0000-0000-000000000000",
        frequency: "monthly" as const,
        next: new Date("2024-02-01 19:36:19.000").getTime(),
      };

}