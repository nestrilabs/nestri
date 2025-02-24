export const domain =
  {
    production: "nestri.io",
    dev: "dev.nestri.io",
  }[$app.stage] || $app.stage + ".dev.nestri.io";

  export const zone = cloudflare.getZoneOutput({
    name: "nestri.io",
  });