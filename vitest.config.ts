import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Plain Vitest config for unit/component tests. We intentionally do NOT reuse
// Astro's full Vite pipeline (getViteConfig) — it loads the Cloudflare adapter,
// whose plugins break Vitest's runner worker. Tests that need `astro:*` virtual
// modules should mock them. The `@/*` alias mirrors tsconfig.json.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Astro's build-time virtual module — Vitest can't resolve it, so map it
      // to an inert stub. See the stub file for the rationale.
      "astro:env/server": fileURLToPath(new URL("./vitest.astro-env-server.stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
