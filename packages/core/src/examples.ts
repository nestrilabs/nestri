import { prefixes } from "./utils";
import { randomBytes } from "crypto";

export module Examples {
    export const Id = (prefix: keyof typeof prefixes) =>
        `${prefixes[prefix]}_XXXXXXXXXXXXXXXXXXXXXXXXX`;

    export const User = {
        id: Id("user"),
        name: "John Doe",
        email: "john@example.com",
        fingerprint: "183ded44-24d0-480e-9908-c022eff8d111",
    };

}