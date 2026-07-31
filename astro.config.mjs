// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  adapter: cloudflare(),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      GUEST_PROGRESS_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
      // Deploy origin used to build the OAuth redirect URL. Not secret; falls
      // back to the request origin locally. See src/pages/api/auth/oauth.ts.
      PUBLIC_SITE_URL: envField.string({ context: "server", access: "public", optional: true }),
      // Service-role key for the server-only admin client (account deletion).
      // Bypasses RLS — never exposed to the browser. See src/lib/supabase-admin.ts.
      SUPABASE_SERVICE_ROLE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
