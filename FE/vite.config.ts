import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { fileURLToPath, URL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";

let buildInfo: { commit: string; dirty: boolean };
let publicDirectory: string | false;
let publicFiles: Record<string, string>;

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: false }),
    react(),
    tailwindcss(),
    {
      name: "build-provenance",
      apply: "build",
      configResolved(config) {
        publicDirectory = config.build.copyPublicDir && config.publicDir;
      },
      buildStart() {
        const cwd = fileURLToPath(new URL("..", import.meta.url));
        const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
        const dirty =
          execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim() !== "";
        buildInfo = { commit, dirty };
        publicFiles = {};
        if (publicDirectory && existsSync(publicDirectory)) {
          for (const name of readdirSync(publicDirectory, { recursive: true, encoding: "utf8" })) {
            const path = join(publicDirectory, name);
            if (statSync(path).isFile())
              publicFiles[name.split(sep).join("/")] = createHash("sha256")
                .update(readFileSync(path))
                .digest("hex");
          }
        }
      },
      writeBundle(output, bundle) {
        if (!output.dir) throw new Error("Frontend build output directory is missing");
        const directory = output.dir;
        const files = { ...publicFiles };
        // Hash this build's output, even if another build has overwritten the directory.
        for (const file of Object.values(bundle))
          files[file.fileName] = createHash("sha256")
            .update(file.type === "chunk" ? file.code : file.source)
            .digest("hex");
        writeFileSync(
          join(directory, "build-info.json"),
          JSON.stringify({ ...buildInfo, files }) + "\n",
        );
      },
    },
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
});
