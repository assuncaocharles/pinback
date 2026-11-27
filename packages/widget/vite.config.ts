import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    lib: {
      entry: 'src/index.ts',
      name: 'PreviewPins',
      formats: ['iife', 'es'],
      fileName: (format) => (format === 'iife' ? 'preview-pins.js' : 'preview-pins.mjs'),
    },
    sourcemap: true,
    minify: true,
  },
});
