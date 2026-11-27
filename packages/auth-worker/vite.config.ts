import { defineConfig } from 'vite';

/** Builds the browser code served as static assets: the auth frame and the OAuth callback. */
export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist/public',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: { frame: 'src/client/frame.ts', callback: 'src/client/callback.ts' },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js', format: 'es' },
    },
  },
});
