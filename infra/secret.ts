export const secret = {
    // InstantAppId: new sst.Secret("InstantAppId"),
    PolarSecret: new sst.Secret("PolarSecret", process.env.POLAR_API_KEY),
    GithubClientID: new sst.Secret("GithubClientID"),
    DiscordClientID: new sst.Secret("DiscordClientID"),
    GithubClientSecret: new sst.Secret("GithubClientSecret"),
    // InstantAdminToken: new sst.Secret("InstantAdminToken"),
    DiscordClientSecret: new sst.Secret("DiscordClientSecret"),
};

export const allSecrets = Object.values(secret);