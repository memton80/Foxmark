import { defineConfig } from "vite";

// Configuration Vite pour le frontend Tauri.
// Le port 1420 est celui attendu par `tauri.conf.json` (build.devUrl).
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Ne pas re-déclencher le serveur de dev quand Rust recompile.
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
});
