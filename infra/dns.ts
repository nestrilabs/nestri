export const domain =
  {
    production: "prod.nestri.io", //temporary use until we go into the real production
    dev: "dev.nestri.io",
  }[$app.stage] || $app.stage + ".dev.nestri.io";

  export const zone = cloudflare.getZoneOutput({
    name: "nestri.io",
  });