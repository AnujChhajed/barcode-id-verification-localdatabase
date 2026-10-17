import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

/**
 * One project root, one build.
 *
 * The frontend is a client-rendered single-page app: it is built into `dist/`
 * and served by the same Node process that exposes `/api` (see
 * `backend/src/app.js`). There is no separate SSR worker and no Cloudflare
 * target, so `npm run dev` and `npm start` are the only two commands needed.
 *
 * In development Vite runs on :8080 and proxies `/api` to the API process on
 * :4000. Proxying keeps the browser on a single origin, so the session cookie
 * behaves exactly as it does in the built app and no CORS is involved.
 */
export default defineConfig({
  plugins: [
    // Must run before the React plugin so generated route files are present.
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsConfigPaths(),
  ],
  server: {
    host: true,
    port: 8080,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
