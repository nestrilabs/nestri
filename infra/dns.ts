export const domain =
  {
    production: "nestri.io",
    dev: "dev.nestri.io",
  }[$app.stage] || $app.stage + ".dev.nestri.io";