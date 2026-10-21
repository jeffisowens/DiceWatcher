import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `pnpm dev:phone` serves over HTTPS with a self-signed cert on the LAN, since
// phones only allow camera access on HTTPS.
export default defineConfig(({ mode }) => ({
  // Relative asset paths, so the build works under GitHub Pages' /<repo>/.
  base: "./",
  plugins: [react(), ...(mode === "https" ? [basicSsl()] : [])],
  server: {
    port: 5173
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        bench: resolve(import.meta.dirname, "bench.html")
      }
    }
  }
}));
