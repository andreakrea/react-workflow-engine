import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    knex: 'src/knex/index.ts',
    server: 'src/server/index.ts',
    react: 'src/react/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2020',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'reactflow', 'knex'],
  // knex/index.ts reads import.meta.url only when __dirname is missing (ESM).
  esbuildOptions(options) {
    options.logOverride = { 'empty-import-meta': 'silent' };
  },
});
