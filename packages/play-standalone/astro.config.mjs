// @ts-check
import { defineConfig, envField } from "astro/config";
import node from "@astrojs/node";

// https://astro.build/config
export default defineConfig({
  adapter: node({
    mode: 'standalone',
  }),
  output: "server",
  server: {
    "host": "0.0.0.0",
    "port": 3000,
  },
  env: {
    schema: {
      PEER_URL: envField.string({ context: "server", access: "secret", optional: true }),
    }
  }
});