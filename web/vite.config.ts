import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `npm run dev` serves the SPA on :5173 and proxies server routes to the Go
// binary (`cd api && go run ./cmd/arkive`, listening on :8080).
const apiTarget = process.env.ARKIVE_API_PROXY || 'http://localhost:8080';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    rollupOptions: {
      output: {
        // Framework code changes rarely; keep it in its own long-cached chunk.
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-dom/client', 'react-router-dom', '@tanstack/react-virtual'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': apiTarget,
      '/dav': apiTarget,
      '/metrics': apiTarget,
    },
  },
});
