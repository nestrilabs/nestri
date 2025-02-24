/// <reference path="./.sst/platform/config.d.ts" />
import { readdirSync } from "fs";
export default $config({
  app(input) {
    return {
      name: "nestri",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "cloudflare",
      providers: {
        cloudflare: "5.37.1",
        docker: "4.5.5",
        "@pulumi/command": "1.0.1",
        random: "4.16.8",
        aws: "6.67.0",
        tls: "5.1.0",
        command: "0.0.1-testwindows.signing",
        awsx: "2.21.0",
      },
    };
  },
  async run() {
    const outputs = {};
    for (const value of readdirSync("./infra/")) {
      const result = await import("./infra/" + value);
      if (result.outputs) Object.assign(outputs, result.outputs);
    }
    return outputs;
  },
});
