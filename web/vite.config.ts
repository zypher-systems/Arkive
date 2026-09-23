import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

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
      '/api': process.env.ARKIVE_API_PROXY || 'http://localhost:8080',
      '/dav': process.env.ARKIVE_API_PROXY || 'http://localhost:8080',
    },
  },
});
