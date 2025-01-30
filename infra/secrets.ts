export const secret = {
    InstantAdminToken: new sst.Secret("InstantAdminToken"),
    InstantAppId: new sst.Secret("InstantAppId"),
    LoopsApiKey: new sst.Secret("LoopsApiKey"),
    GithubClientSecret: new sst.Secret("GithubClientSecret"),
    GithubClientID: new sst.Secret("GithubClientID"),
    DiscordClientSecret: new sst.Secret("DiscordClientSecret"),
    DiscordClientID: new sst.Secret("DiscordClientID"),
    AwsKey: new sst.Secret("AWS_KEY"),
    AwsAccess: new sst.Secret("AWS_ACCESS"),
  };
  
  export const allSecrets = Object.values(secret);