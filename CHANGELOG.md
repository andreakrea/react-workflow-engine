# Changelog

## 2.0.0

A rewrite. Stored data is compatible with 1.x (same `workflows` table and migration name; workflows saved by the 1.x editor load and run); the API is new — see "Upgrading from 1.x" in the README.

### Fixed (1.x bugs)
- `transition()` threw on every call in 1.4.0, after saving the new state.
- Decisions like `"no"`, `"rejected"` or a typo followed the YES branch; unknown branches now throw.
- Moving "by type" could pick an unreachable node; now only reachable nodes are considered, and ambiguity throws.
- `require('vise-workflow-engine')` failed without Express installed.
- Editor: wrong API path (`/api/workflows` appended), no auth headers, fixed viewport height, global Tailwind reset leaking into the host page, block colours that needed Tailwind in the host, black MiniMap nodes, hooks losing their position, duplicate node ids after reload.
- License keys could be forged from the published source.

### Added
- Typed engine: `defineBlocks` / `defineHooks` shared by server and editor; actions typed by block (variables, branches); action results are moves (`{ next }`, `{ branch }`, `{ to }`).
- Storage adapters: knex (Postgres, MySQL, SQLite) and in-memory; one transaction per move with the subject row locked.
- Run history (`engine.history`, migration 002) with the acting user; `engine.get` for where a subject is and what can happen next.
- Waits and retries: `{ wait: '3d' }` from actions, `retry` policies on blocks, `engine.runDue` / `engine.startTimers`, migration 003.
- HTTP: `createHandler` (workflow CRUD) and `createSubjectHandler` (start, move, read, history) as standard fetch handlers, with `toNodeHandler` for Express.
- Validation with errors and warnings, shown live in the editor and returned by the API.
- Editor: injectable client, controlled mode, light/dark/system themes, hooks sidebar, undo/redo, search, mobile bottom sheets, `icons` and `labels` (English and Italian) props.
- TypeScript types for everything; ESM and CommonJS builds.

### Changed
- Package entry points: `vise-workflow-engine`, `/knex`, `/server`, `/react`, `/react/style.css`.
- Editor peer dependency: `@xyflow/react` 12 (was `reactflow` 11).
- License keys are Ed25519-signed (`vwe2.…`); 1.x keys still work with a warning until 3.0. The editor and in-memory stores need no key.
