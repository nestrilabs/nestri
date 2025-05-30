export const secret = {
    PolarSecret: new sst.Secret("PolarSecret", process.env.POLAR_API_KEY),
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

sst.Linkable.wrap(random.RandomString, (resource) => ({
    properties: {
        value: resource.result,
    },
}));

export const steamEncryptionKey = new random.RandomString(
    "SteamEncryptionKey",
    {
        length: 32,
    },
);