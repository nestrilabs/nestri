/// <reference path="./.sst/platform/config.d.ts" />
import { readdirSync } from "fs";
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
        random: "4.17.0",
        neon: "0.6.3",
        command: "1.0.2",
      },
    };
  },
  async run() {
    
    $transform(sst.aws.Function, (args) => {
      args.environment = $resolve([args.environment]).apply(([environment]) => {
        return {
          ...environment,
          NODE_OPTIONS: "--experimental-websocket",
        };
      });
    });

    const outputs = {};
    for (const value of readdirSync("./infra/")) {
      const result = await import("./infra/" + value);
      if (result.outputs) Object.assign(outputs, result.outputs);
    }
    return outputs;
  },
});
