/// <reference types="vitest/config" />
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:4000';

// `vite build --mode demo` bundles the hub engine into the page (Vercel demo).
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../server/src/domain'),
      '@backend': path.resolve(__dirname, mode === 'demo' ? 'src/backend/demo.ts' : 'src/backend/http.ts'),
      // Node built-ins used by the shared engine code - only reached in demo builds.
      'node:events': path.resolve(__dirname, 'src/backend/shims/events.ts'),
      'node:crypto': path.resolve(__dirname, 'src/backend/shims/crypto.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/socket.io': { target: API, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
    css: false,
  },
}));
