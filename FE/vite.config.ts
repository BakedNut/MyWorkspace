import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { fileURLToPath, URL } from "node:url";
import { execFileSync } from "node:child_process";

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: false }),
    react(),
    tailwindcss(),
    {
      name: "build-provenance",
      apply: "build",
      buildStart() {
        const cwd = fileURLToPath(new URL("..", import.meta.url));
        const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
        const dirty =
          execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim() !== "";
        this.emitFile({
          type: "asset",
          fileName: "build-info.json",
          source: JSON.stringify({ commit, dirty }) + "\n",
        });
      },
    },
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
});
