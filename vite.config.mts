import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ["sheilah-diffractive-modesta.ngrok-free.dev"],
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", () => {
            console.log("[proxy] API proxy error — is the backend running?");
          });
        }
      },
      "/socket.io": {
        target: "http://localhost:3001",
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", () => {
            console.log("[proxy] WebSocket proxy error — backend may have restarted");
          });
        }
      }
    }
  }
});
