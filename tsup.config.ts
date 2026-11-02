import { defineConfig } from 'tsup';

export default defineConfig([
  // Library entries: peer dependencies stay external.
  {
    entry: {
      index: 'src/index.ts',
      knex: 'src/knex/index.ts',
      server: 'src/server/index.ts',
      react: 'src/react/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    target: 'es2020',
    external: ['react', 'react-dom', 'react/jsx-runtime', '@xyflow/react', 'knex'],
    // knex/index.ts reads import.meta.url only when __dirname is missing (ESM).
    esbuildOptions(options) {
      options.logOverride = { 'empty-import-meta': 'silent' };
    },
  },
  // <vise-workflow-editor>: self-contained for any framework, React and CSS bundled in.
  {
    entry: { element: 'src/element/index.ts' },
    format: ['esm', 'iife'],
    globalName: 'ViseWorkflowEditor',
    platform: 'browser',
    target: 'es2020',
    dts: true,
    minify: true,
    sourcemap: false,
    noExternal: [/.*/],
    loader: { '.css': 'text' },
    define: { 'process.env.NODE_ENV': '"production"' },
    outExtension: ({ format }) => ({ js: format === 'iife' ? '.global.js' : '.mjs' }),
  },
]);
