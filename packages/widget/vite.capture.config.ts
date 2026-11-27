import { defineConfig } from 'vite';

/** Builds the lazy capture module next to the widget: dist/preview-pins-capture.mjs. */
export default defineConfig({
  build: {
    target: 'es2022',
    emptyOutDir: false,
    sourcemap: true,
    minify: true,
    lib: {
      entry: 'src/capture/index.ts',
      formats: ['es'],
      fileName: () => 'preview-pins-capture.mjs',
    },
  },
});
