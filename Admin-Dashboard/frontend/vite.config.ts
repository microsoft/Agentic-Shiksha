import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5174,
    proxy: {
      // Proxy auth calls to main backend (port 8000) so session
      // cookies travel same-origin.
      "/auth": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
