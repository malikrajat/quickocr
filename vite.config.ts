import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        'service-worker': resolve(__dirname, 'src/service-worker.ts'),
        'content-selection': resolve(__dirname, 'src/content/selection.ts'),
        'settings': resolve(__dirname, 'src/settings/settings.ts'),
        'offscreen': resolve(__dirname, 'src/offscreen.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
      },
    },
    minify: false,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
