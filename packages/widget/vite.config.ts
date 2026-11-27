import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    lib: {
      entry: 'src/index.ts',
      name: 'Pinback',
      formats: ['iife', 'es'],
      fileName: (format) => (format === 'iife' ? 'pinback.js' : 'pinback.mjs'),
    },
    sourcemap: true,
    minify: true,
  },
});
