import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * The content script is injected as a classic script, so it needs a single
 * self-contained IIFE bundle with no dynamic imports.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/content/page-capture.ts'),
      name: 'LogLensPageCapture',
      formats: ['iife'],
      fileName: () => 'page-capture.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    minify: false,
    sourcemap: false,
  },
});
