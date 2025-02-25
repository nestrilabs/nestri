// @ts-check
import aws from "astro-sst";
import react from "@astrojs/react";
import solid from "@astrojs/solid-js";
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  vite: {
    server: {
      watch: {
        usePolling: true,
      },
    },
    // @ts-ignore
    plugins: [tailwindcss()],
  },
  adapter: aws(),
  output: "server",
  server: { host: true },
  integrations: [
    solid({ exclude: "**/cui/**/*" }),
    react({ include: "**/cui/**/*" }),
  ],
});
