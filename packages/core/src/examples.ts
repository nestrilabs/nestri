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

}