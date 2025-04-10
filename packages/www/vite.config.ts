import path from "path";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { macaronVitePlugin } from "@macaron-css/vite";

export default defineConfig({
    plugins: [macaronVitePlugin(), solidPlugin()],
    server: {
        port: 3000,
        host: "0.0.0.0",
    },
    build: {
        target: "esnext",
    },
    resolve: {
        alias: {
            "@nestri/www": path.resolve(__dirname, "./src"),
        },
    },
});