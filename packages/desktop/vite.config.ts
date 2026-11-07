import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  // Nunca fuentes en data: URI: la CSP (font-src 'self') las bloquearía.
  build: { target: "es2023", assetsInlineLimit: 0 },
});
