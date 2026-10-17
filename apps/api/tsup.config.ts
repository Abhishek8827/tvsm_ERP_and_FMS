import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  outDir: 'dist',
  target: 'node20',
  clean: true,
  // @erp/shared ships TypeScript source, so it must be bundled into the server output.
  noExternal: ['@erp/shared'],
});
