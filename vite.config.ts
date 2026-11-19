import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Extension pages and the module service worker. Shared code is emitted as
 * ES chunks, which Manifest V3 extension pages and module service workers can
 * load. The page-capture content script is built separately as an IIFE because
 * Chrome content scripts cannot use ES module imports.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        logs: resolve(__dirname, 'logs.html'),
        options: resolve(__dirname, 'options.html'),
        'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
        format: 'es',
      },
    },
    minify: false,
    sourcemap: false,
  },
});
