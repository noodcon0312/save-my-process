# save-my-process

[![npm version](https://img.shields.io/npm/v/save-my-process)](https://www.npmjs.com/package/save-my-process)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

Save your shell history, installed `pip`/`npm` packages, and project files to a single archive before your session (browser tab, sandbox, container) closes — and restore them later.

Works on **Windows, macOS, Linux**. No native dependencies.

## Install

```bash
# as a CLI globally
npm install -g save-my-process

# or as a library in your project
npm install save-my-process
```

## CLI Usage

### Export current session

```bash
save-my-process
# name?  my-session
# zip? (yes/no) yes
# split? (yes/no) no
# → creates .my-session-export/my-session.zip
```

Options asked interactively:
- **name** — base name for output files (default `smp_<timestamp>`)
- **zip** — pack `export.json` into a `.zip` (recommended)
- **split** — split output into ≤100MB parts (`_part_1_of_N`) for environments with upload/download limits

Supports piped input (CI / scripting):

```bash
printf "my-session\nyes\nno\n" | save-my-process
```

### Import / Restore

```bash
save-my-process import my-session.zip
# or
save-my-process import export.json
```

What restore does:
- appends saved bash history to `~/.bash_history`
- writes `requirements.txt` next to the export and runs `pip install -r`
- decodes and writes every captured project file back to disk

> Split parts (`.part`) must be reassembled first:
> ```bash
> cat my-session_part_*.zip.part > my-session.zip
> save-my-process import my-session.zip
> ```

### Other

```bash
save-my-process --version
```

## Library Usage

Use it programmatically in Node.js (ESM):

```js
import { gatherExportData, packageExportData, importExportData } from 'save-my-process';

// 1. Gather
const exportData = gatherExportData({
  cwd: '/path/to/project',
  onProgress: (msg) => console.log(msg),
});
// exportData = { history, pipList, npmList, files: [{ path, content: base64 }] }

// 2. Package to disk
const files = await packageExportData({
  exportData,
  outDir: './my-backup',
  baseName: 'my-session',
  zip: true,      // true → .zip, false → .json
  split: false,   // true → split into ≤100MB chunks
  onProgress: console.log,
});
// files = [{ name, path }]

// 3. Restore later
importExportData({
  jsonPath: './my-backup/export.json', // or extracted from zip
  targetDir: '/where/to/restore',
  onProgress: console.log,
});
```

### API

#### `gatherExportData({ cwd?, onProgress? })`
Scans `~/.bash_history`, `pip freeze`, `npm list`, and all project files (skips `node_modules`, `.git`, `venv`, `.next`, `dist`). Returns `{ history, pipList, npmList, files }`.

#### `packageExportData({ exportData, outDir, baseName?, zip?, split?, onProgress? })`
Writes `export.json` and optionally zips/splits it. Returns `Promise<{ name, path }[]>`.

#### `importExportData({ jsonPath, targetDir?, onProgress? })`
Restores history, pip packages, and files from an `export.json`.

## Requirements

- Node.js `>=18`
- Optional: `pip`/`pip3` and `npm` on PATH (gracefully skipped if missing)

## Publishing (for maintainers)

```bash
npm login
npm view save-my-process   # confirm name is available (currently free)
npm publish                # or: npm publish --access public
```

If the name is taken, publish under a scope:

```json
{ "name": "@your-scope/save-my-process" }
```

Then:

```bash
npm publish --access public
```

## License

MIT — see [LICENSE](./LICENSE)
