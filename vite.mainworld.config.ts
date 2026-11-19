import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * MAIN-world page instrumentation. Chrome content scripts in the MAIN world
 * must still be classic scripts, so this is a self-contained IIFE.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/content/page-capture-main.ts'),
      name: 'LogLensPageCaptureMain',
      formats: ['iife'],
      fileName: () => 'page-capture-main.js',
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
