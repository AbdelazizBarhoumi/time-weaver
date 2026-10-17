// vite.config.ts
import { defineConfig } from "file:///D:/projects/time-weaver/node_modules/vite/dist/node/index.js";
import laravel from "file:///D:/projects/time-weaver/node_modules/laravel-vite-plugin/dist/index.js";
import tanstackRouter from "file:///D:/projects/time-weaver/node_modules/@tanstack/router-plugin/dist/esm/vite.js";
import viteReact from "file:///D:/projects/time-weaver/node_modules/@vitejs/plugin-react/dist/index.js";
import tailwindcss from "file:///D:/projects/time-weaver/node_modules/@tailwindcss/vite/dist/index.mjs";
import tsConfigPaths from "file:///D:/projects/time-weaver/node_modules/vite-tsconfig-paths/dist/index.js";
var vite_config_default = defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./resources/js/routes",
      generatedRouteTree: "./resources/js/routeTree.gen.ts"
    }),
    viteReact({
      include: "**/*.tsx"
    }),
    laravel({
      input: "resources/js/start.tsx",
      refresh: true
    }),
    tailwindcss(),
    tsConfigPaths()
  ]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxwcm9qZWN0c1xcXFx0aW1lLXdlYXZlclwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRDpcXFxccHJvamVjdHNcXFxcdGltZS13ZWF2ZXJcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0Q6L3Byb2plY3RzL3RpbWUtd2VhdmVyL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVcIjtcbmltcG9ydCBsYXJhdmVsIGZyb20gXCJsYXJhdmVsLXZpdGUtcGx1Z2luXCI7XG5pbXBvcnQgdGFuc3RhY2tSb3V0ZXIgZnJvbSBcIkB0YW5zdGFjay9yb3V0ZXItcGx1Z2luL3ZpdGVcIjtcbmltcG9ydCB2aXRlUmVhY3QgZnJvbSBcIkB2aXRlanMvcGx1Z2luLXJlYWN0XCI7XG5pbXBvcnQgdGFpbHdpbmRjc3MgZnJvbSBcIkB0YWlsd2luZGNzcy92aXRlXCI7XG5pbXBvcnQgdHNDb25maWdQYXRocyBmcm9tIFwidml0ZS10c2NvbmZpZy1wYXRoc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICAgIHBsdWdpbnM6IFtcbiAgICAgICAgdGFuc3RhY2tSb3V0ZXIoe1xuICAgICAgICAgICAgdGFyZ2V0OiBcInJlYWN0XCIsXG4gICAgICAgICAgICBhdXRvQ29kZVNwbGl0dGluZzogdHJ1ZSxcbiAgICAgICAgICAgIHJvdXRlc0RpcmVjdG9yeTogXCIuL3Jlc291cmNlcy9qcy9yb3V0ZXNcIixcbiAgICAgICAgICAgIGdlbmVyYXRlZFJvdXRlVHJlZTogXCIuL3Jlc291cmNlcy9qcy9yb3V0ZVRyZWUuZ2VuLnRzXCIsXG4gICAgICAgIH0pLFxuICAgICAgICB2aXRlUmVhY3Qoe1xuICAgICAgICAgICAgaW5jbHVkZTogXCIqKi8qLnRzeFwiLFxuICAgICAgICB9KSxcbiAgICAgICAgbGFyYXZlbCh7XG4gICAgICAgICAgICBpbnB1dDogXCJyZXNvdXJjZXMvanMvc3RhcnQudHN4XCIsXG4gICAgICAgICAgICByZWZyZXNoOiB0cnVlLFxuICAgICAgICB9KSxcbiAgICAgICAgdGFpbHdpbmRjc3MoKSxcbiAgICAgICAgdHNDb25maWdQYXRocygpLFxuICAgIF0sXG59KTsiXSwKICAibWFwcGluZ3MiOiAiO0FBQTZQLFNBQVMsb0JBQW9CO0FBQzFSLE9BQU8sYUFBYTtBQUNwQixPQUFPLG9CQUFvQjtBQUMzQixPQUFPLGVBQWU7QUFDdEIsT0FBTyxpQkFBaUI7QUFDeEIsT0FBTyxtQkFBbUI7QUFFMUIsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDeEIsU0FBUztBQUFBLElBQ0wsZUFBZTtBQUFBLE1BQ1gsUUFBUTtBQUFBLE1BQ1IsbUJBQW1CO0FBQUEsTUFDbkIsaUJBQWlCO0FBQUEsTUFDakIsb0JBQW9CO0FBQUEsSUFDeEIsQ0FBQztBQUFBLElBQ0QsVUFBVTtBQUFBLE1BQ04sU0FBUztBQUFBLElBQ2IsQ0FBQztBQUFBLElBQ0QsUUFBUTtBQUFBLE1BQ0osT0FBTztBQUFBLE1BQ1AsU0FBUztBQUFBLElBQ2IsQ0FBQztBQUFBLElBQ0QsWUFBWTtBQUFBLElBQ1osY0FBYztBQUFBLEVBQ2xCO0FBQ0osQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
