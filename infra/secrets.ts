export const secret = {
    InstantAdminToken: new sst.Secret("InstantAdminToken"),
    InstantAppId: new sst.Secret("InstantAppId"),
    LoopsApiKey: new sst.Secret("LoopsApiKey")
  };
  
  export const allSecrets = Object.values(secret);