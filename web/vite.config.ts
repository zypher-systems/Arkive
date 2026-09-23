import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `npm run dev` serves the SPA on :5173 and proxies server routes to the Go
// binary (`cd api && go run ./cmd/arkive`, listening on :8080).
const apiTarget = process.env.ARKIVE_API_PROXY || 'http://localhost:8080';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': apiTarget,
      '/dav': apiTarget,
      '/metrics': apiTarget,
    },
  },
});
