// @ts-check
import aws from "astro-sst"
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

import solidJs from '@astrojs/solid-js';

// https://astro.build/config
export default defineConfig({
  vite: {
    //@ts-ignore
    plugins: [tailwindcss()]
  },
  adapter: aws(),
  output:"server",
  server: { host: true },
  integrations: [react(), solidJs()]
});