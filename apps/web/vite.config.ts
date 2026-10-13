import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.FINO_API_ORIGIN ?? 'http://127.0.0.1:8787';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/mcp': { target: api, changeOrigin: false },
      '/graphql': { target: api, changeOrigin: false },
      '/api': { target: api, changeOrigin: false },
      '/healthz': { target: api, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
