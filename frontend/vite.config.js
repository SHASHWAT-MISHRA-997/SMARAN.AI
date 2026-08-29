import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

import pkg from './package.json' with { type: 'json' };

// Stamped into every asset filename so a release cannot be served from a
// stale browser cache. This used to be its own hardcoded string, which meant
// remembering to change it in two places; bumping package.json to 2.8.7 and
// building produced assets still named v2.8.6, so the new build would have
// gone out under the old names. Read from the one place the version lives.
const BUILD_VERSION = `v${pkg.version}`;

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  define: {
    // Inject the build version so each release gets a distinct asset hash.
    __BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
  },
  build: {
    outDir: '../backend/frontend_dist',
    emptyOutDir: true,
    // The console intentionally bundles the interactive workspace together.
    // Avoid a misleading production build size warning.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Include version stamp in asset filenames to guarantee cache bust
        entryFileNames: `assets/[name]-${BUILD_VERSION}-[hash].js`,
        chunkFileNames: `assets/[name]-${BUILD_VERSION}-[hash].js`,
        assetFileNames: `assets/[name]-${BUILD_VERSION}-[hash].[ext]`,
      },
    },
  },
  server: {
    port: 3003,
    host: '0.0.0.0', // Exposes the server to the local network (LAN)
    proxy: {
      '/api': {
        // Keep local development aligned with the combined Docker deployment.
        // Port 3001 is frequently occupied by unrelated local applications.
        target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        // WebSocket proxy for live telemetry stream (/ws/telemetry)
        target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
});
