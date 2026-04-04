import { defineConfig } from 'vite';

function inferBaseFromGithub() {
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
  if (!repo) return '/';
  return `/${repo}/`;
}

// Base URL priority:
// 1) VITE_BASE explicit override
// 2) GitHub Actions repo-derived base for Pages deployments
// 3) Local/default '/'
const base = process.env.VITE_BASE
  ?? (process.env.GITHUB_ACTIONS ? inferBaseFromGithub() : '/');

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
