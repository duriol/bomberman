import { defineConfig } from 'vite';

// When deploying to GitHub Pages set VITE_BASE to '/<repo-name>/'
// e.g. VITE_BASE=/bomberman/ pnpm build
// For local dev or custom domain, leave unset (defaults to '/')
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    port: 3000,
  },
});
