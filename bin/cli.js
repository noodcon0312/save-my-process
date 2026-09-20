#!/usr/bin/env node
import readline from 'readline';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import {
  gatherExportData,
  packageExportData,
  importExportData,
} from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));

function isYes(answer) {
  return answer.trim().toLowerCase() === 'yes' || answer.trim().toLowerCase() === 'y';
}

async function runExport() {
  // A single readline interface, read as an async iterator: readline emits
  // 'close' as soon as stdin hits EOF, which — with piped input where all
  // lines arrive at once — can happen in the gap *between* two sequential
  // rl.question() calls, silently dropping later prompts. Iterating with
  // `for await` consumes lines as they arrive instead of re-arming a
  // question after each answer, so it doesn't race the 'close' event.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompts = ['name? ', 'zip? (yes/no) ', 'split? (yes/no) '];
  const answers = [];

  process.stdout.write(prompts[0]);
  for await (const line of rl) {
    answers.push(line);
    if (answers.length === prompts.length) break;
    process.stdout.write(prompts[answers.length]);
  }
  rl.close();

  const name = (answers[0] || '').trim() || `smp_${Date.now()}`;
  const zip = isYes(answers[1] || '');
  const split = isYes(answers[2] || '');

  const exportData = gatherExportData({ onProgress: (m) => console.log(m) });

  const outDir = path.join(process.cwd(), `.${name}-export`);
  const files = await packageExportData({
    exportData,
    outDir,
    baseName: name,
    zip,
    split,
    onProgress: (m) => console.log(m),
  });

  for (const f of files) {
    console.log(`Saved: ${f.path}`);
  }
  console.log(`Done! File saved: ${name}`);
}

async function runImport(filePath) {
  if (!filePath) {
    console.error('Usage: save-my-process import <file.json|file.zip>');
    process.exit(1);
  }
  const resolved = path.resolve(filePath);
  let jsonPath = resolved;

  if (resolved.endsWith('.zip')) {
    const tmpDir = path.join(process.cwd(), `.smp_import_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const zipBuf = fs.readFileSync(resolved);
    const jszip = await JSZip.loadAsync(zipBuf);
    const entry = jszip.file('export.json');
    if (!entry) {
      console.error('Error: export.json not found inside the zip.');
      process.exit(1);
    }
    const jsonStr = await entry.async('string');
    jsonPath = path.join(tmpDir, 'export.json');
    fs.writeFileSync(jsonPath, jsonStr);
  } else if (resolved.endsWith('.part')) {
    console.error('Cannot import a split part directly. Combine the parts first, e.g.:');
    console.error('  cat name_part_*.zip.part > name.zip');
    process.exit(1);
  }

  importExportData({ jsonPath, onProgress: (m) => console.log(m) });
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);

  if (cmd === '--version' || cmd === 'version') {
    console.log(pkg.version);
    return;
  }

  if (cmd === 'import') {
    await runImport(arg);
    return;
  }

  if (!cmd) {
    await runExport();
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  console.error('Usage:');
  console.error('  save-my-process            # export current session');
  console.error('  save-my-process import <f>  # restore from a previous export');
  console.error('  save-my-process --version');
  process.exit(1);
}

main();
