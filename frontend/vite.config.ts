import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'reactflow'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          reactflow: 'ReactFlow',
        },
        assetFileNames: '[name][extname]',
      },
    },
    cssCodeSplit: false,
  },
});
