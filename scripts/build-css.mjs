// Bundles ReactFlow's structural CSS with the editor's own scoped stylesheet,
// so consumers import a single file and need no Tailwind or global reset.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const reactflowBase = readFileSync(require.resolve('@xyflow/react/dist/base.css'), 'utf8');
const editor = readFileSync(new URL('../src/react/style.css', import.meta.url), 'utf8');

writeFileSync(
  new URL('../dist/style.css', import.meta.url),
  `/* @xyflow/react base styles (MIT) */\n${reactflowBase}\n/* vise-workflow-engine */\n${editor}`,
);
console.log('dist/style.css written');
