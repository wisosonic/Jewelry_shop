import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Binds to 0.0.0.0 (all network interfaces) instead of just localhost,
    // so the dev server is reachable from another device on the same LAN
    // (e.g. a phone) via the laptop's local IP, not just from the laptop
    // itself. The /api and /uploads proxy targets below stay "localhost"
    // regardless - that proxying happens server-side, on the same machine
    // running this Vite process, never from the phone's browser.
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/uploads": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      // The notification system's real-time Socket.IO connection - `ws:
      // true` proxies the WebSocket upgrade too, not just plain HTTP.
      "/socket.io": {
        target: "http://localhost:4000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
