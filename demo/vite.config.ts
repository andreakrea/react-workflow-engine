import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

// The demo runs on the local source, so it always shows the current code.
export default defineConfig({
  plugins: [react()],
  base: '/react-workflow-engine/',
  resolve: {
    alias: [
      { find: 'vise-workflow-engine/react/style.css', replacement: root('dist/style.css') },
      { find: 'vise-workflow-engine/react', replacement: root('src/react/index.ts') },
      { find: /^vise-workflow-engine$/, replacement: root('src/index.ts') },
    ],
    dedupe: ['react', 'react-dom', '@xyflow/react'],
  },
});
