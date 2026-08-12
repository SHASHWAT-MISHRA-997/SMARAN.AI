import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Build version stamp — change this to force new asset hashes and bust browser cache
const BUILD_VERSION = 'v1.0.0';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  define: {
    // Inject build version into the bundle — changes the hash every time this value changes
    __BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
  },
  build: {
    outDir: '../backend/frontend_dist',
    emptyOutDir: true,
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
