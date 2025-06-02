export const secret = {
    PolarSecret: new sst.Secret("PolarSecret", process.env.POLAR_API_KEY),
    SteamApiKey: new sst.Secret("SteamApiKey"),
    GithubClientID: new sst.Secret("GithubClientID"),
    DiscordClientID: new sst.Secret("DiscordClientID"),
    PolarWebhookSecret: new sst.Secret("PolarWebhookSecret"),
    GithubClientSecret: new sst.Secret("GithubClientSecret"),
    DiscordClientSecret: new sst.Secret("DiscordClientSecret"),
    
    // Pricing
    NestriFreeMonthly: new sst.Secret("NestriFreeMonthly"),
    NestriProMonthly: new sst.Secret("NestriProMonthly"),
    NestriProYearly: new sst.Secret("NestriProYearly"),
    NestriFamilyMonthly: new sst.Secret("NestriFamilyMonthly"),
    NestriFamilyYearly: new sst.Secret("NestriFamilyYearly"),
};

export const allSecrets = Object.values(secret);