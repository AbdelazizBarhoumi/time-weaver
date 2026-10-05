import { defineConfig } from "vite";
import laravel from "laravel-vite-plugin";
import tanstackRouter from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    plugins: [
        tanstackRouter({
            target: "react",
            autoCodeSplitting: true,
            routesDirectory: "./resources/js/routes",
            generatedRouteTree: "./resources/js/routeTree.gen.ts",
        }),
        viteReact({
            include: "**/*.tsx",
            fastRefresh: true,
        }),
        laravel({
            input: "resources/js/start.tsx",
            refresh: true,
        }),
        tailwindcss(),
        tsConfigPaths(),
    ],
});