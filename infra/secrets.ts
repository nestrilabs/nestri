export const secret = {
  LoopsApiKey: new sst.Secret("LoopsApiKey"),
  InstantAppId: new sst.Secret("InstantAppId"),
  AwsSecretKey: new sst.Secret("AwsSecretKey"),
  AwsAccessKey: new sst.Secret("AwsAccessKey"),
  GithubClientID: new sst.Secret("GithubClientID"),
  DiscordClientID: new sst.Secret("DiscordClientID"),
  GithubClientSecret: new sst.Secret("GithubClientSecret"),
  InstantAdminToken: new sst.Secret("InstantAdminToken"),
  DiscordClientSecret: new sst.Secret("DiscordClientSecret"),
  };
  
  export const allSecrets = Object.values(secret);