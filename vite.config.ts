import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    {
      name: "isolated-injection",
      apply: "build",
      renderChunk(code, chunk) {
        if (chunk.name !== "injected") return;
        if (
          chunk.imports.length ||
          chunk.exports.length ||
          chunk.dynamicImports.length
        )
          this.error("Injected script must be standalone");
        return { code: `(()=>{${code}\n})();`, map: null };
      },
    },
  ],
  publicDir: "assets/extension",
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        worker: resolve(import.meta.dirname, "src/worker.ts"),
        injected: resolve(import.meta.dirname, "src/injected.ts"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  test: { environment: "node", include: ["test/**/*.test.{ts,tsx}"] },
});
