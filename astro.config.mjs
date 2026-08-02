// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  // @astrojs/sitemap was registered here but skipped on every build: it
  // requires a static `site` origin, which this project does not set. Re-add
  // it together with `site: "https://<deploy-origin>"` when SEO matters.
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    // Force a single React instance across the app and all pre-bundled deps.
    // Without this, Vite can pull a second copy of React/React-DOM in through
    // deps like @radix-ui/react-slot (via ui/button) and react-dom's
    // useFormStatus, producing "Invalid hook call / more than one copy of
    // React" and blanking the auth-form islands on hydration.
    resolve: { dedupe: ["react", "react-dom"] },
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
