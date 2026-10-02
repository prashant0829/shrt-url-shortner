import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the API runs separately on :8080. Proxying keeps the browser on a single
    // origin, so no CORS configuration is needed.
    proxy: { '/api': 'http://localhost:8080' },
  },
  build: {
    // The Express server serves the built app from server/public.
    outDir: '../server/public',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/main.jsx', 'src/test/**', 'src/**/*.test.{js,jsx}'],
      reporter: ['text-summary', 'html'],
    },
  },
});
