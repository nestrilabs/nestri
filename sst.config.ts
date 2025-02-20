/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app(input) {
    return {
      name: "nestri",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: {
        aws: {
          region: "us-east-1",
          profile:
            input.stage === "production" ? "nestri-production" : "nestri-dev",
        },
        cloudflare: "5.49.0",
      },
    };
  },
  async run() {
    await import("./infra/www");
  },
});
