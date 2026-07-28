import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/mobile",
  base: "/",
  plugins: [react()],
  build: {
    outDir: "../../dist/mobile",
    emptyOutDir: true
  }
});
