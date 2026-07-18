import { defineConfig } from "vite";

// Tauri expects a fixed dev-server port and leaves the src-tauri crate to
// Cargo's own watcher. See the Tauri "Vite" integration guide.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // Tauri picks up the built assets from ../dist (see tauri.conf.json).
    outDir: "dist",
    target: "es2021",
    sourcemap: true,
  },
});
