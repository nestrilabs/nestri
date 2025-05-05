import { prefixes } from "./utils";

export const Id = (prefix: keyof typeof prefixes) =>
        `${prefixes[prefix]}_XXXXXXXXXXXXXXXXXXXXXXXXX`;

export const User = {
    id: Id("user"),// Primary key
    email: "johndoe@example.com",// Unique email or login (not null)
    displayName: "John Doe", // Display name (not null)
    username: "john_doe", // user name (not null)
}

export const GPUType = {
    id: Id("gpu"),
    type: "hosted" as const, //or BYOG - Bring Your Own GPU
    name: "RTX 4090" as const, // or RTX 3090, Intel Arc
}

export const Machine = {
    id: Id("machine"),
    ownerID: User.id, //or null if hosted
    gpuID: GPUType.id, // or hosted
    country: "Kenya",
    countryCode: "KE",
    timezone: "Africa/Nairobi",
    location: { latitude: 36.81550, longitude: -1.28410 },
    fingerprint: "fc27f428f9ca47d4b41b707ae0c62090",
}

export const Team = {
    id: Id("team"),// Primary key
    name: "John's Console", // Team name (not null, unique)
    ownerID: User.id, // FK to User who owns/created the team
    machineID: Machine.id
};

export const SteamAccount = {
    id: 74839300282033n,                // Primary key
    userID: User.id,// | null  FK to User (null if not linked)
    avatarHash: "3a5e805fd4c1e04e26a97af0b9c6fab2dee91a19",
    realName: "John Doe",
    personaName: "JD The 65th",
    profileUrl: "https://steamcommunity.com/id/XXXXXXXXXXXXXXXX/",
};

export const TeamMember = {
    id: Id("member"),
    userID: User.id,//FK to Users (member)
    steamID: SteamAccount.id, // FK to the Steam Account this member is used
    teamID: Team.id,// FK to Teams
    role: "adult" as const, // Role on the team, adult or child
};

export const ProductVariant = {
    id: Id("variant"),
    productID: Id("product"),// the product this variant is under
    type: "fixed" as const, // or yearly or monthly,
    price: 1999,
    minutesPerDay: 3600,
    polarProductID: "0bfcb712-df13-4454-81a8-fbee66eddca4"
}

export const Product = {
    id: Id("product"),
    name: "Pro",
    description: "For gamers",
    totalMembers: 3,//Total number of people who can share this sub
    maxResolution: "1080p", //Maximum resolution this product gives
    variants: [ProductVariant]
}

export const Subscription = {
    id: Id("subscription"),
    teamID: Team.id,
    status: "active" as const, //incomplete, incomplete_expired, trialing, active, past_due, canceled, unpaid
    ownerID: User.id,
    price: ProductVariant.price,
    productVariantID: ProductVariant.id,
    polarSubscriptionID: "0bfcb712-df13-4454-81a8-fbee66eddca4",
}

export const SubscriptionUsage = {
    id: Id("usage"),
    machineID: Machine.id, // machine this session was used on
    memberID: TeamMember.id, // the team member who used it
    subscriptionID: Subscription.id,
    sessionID: Id("session"),
    minutesUsed: 20, // Minutes used on the session
}

export const Session = {
    id: Id("session"),
    memberID: TeamMember.id,
    machineID: Machine.id,
    startTime: new Date("2025-02-23T33:39:52.249Z"),
    endTime: null, // null if session is ongoing
    gameID: Id("game"),
    status: "active" as const, // active, completed, crashed
}