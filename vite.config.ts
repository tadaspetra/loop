import path from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  root: path.resolve(__dirname, 'src'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: false,
    // Keep ?url imports (e.g. audio worklet) as files so script-src 'self' CSP allows addModule().
    assetsInlineLimit: 0
  }
});
