import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import JSZip from 'jszip';

const SKIP_DIRS = new Set(['node_modules', '.git', 'venv', '.next', 'dist']);
const PART_SIZE = 100 * 1024 * 1024; // 100MB

/**
 * Recursively list files under `dir`, skipping SKIP_DIRS, returning paths
 * relative to `dir` with forward slashes (so exports are portable between
 * Windows and Unix). Replaces the old `find ... -not -path` shell command,
 * which doesn't exist on Windows.
 */
function listFiles(dir, base = dir) {
  let results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results = results.concat(listFiles(path.join(dir, entry.name), base));
    } else if (entry.isFile()) {
      const rel = path.relative(base, path.join(dir, entry.name)).split(path.sep).join('/');
      results.push(rel);
    }
  }
  return results;
}

/**
 * Gather bash history, pip/npm package lists, and project files into a
 * single export bundle.
 *
 * @param {object} opts
 * @param {string} [opts.cwd] - directory to snapshot (default: process.cwd())
 * @param {(msg: string) => void} [opts.onProgress] - optional progress callback
 * @returns {{ history: string, pipList: string, npmList: string, files: {path: string, content: string}[] }}
 */
export function gatherExportData({ cwd = process.cwd(), onProgress = () => {} } = {}) {
  onProgress('Gathering data...');

  let history = '';
  let pipList = '';
  let npmList = '';
  const filesData = [];

  try {
    history = fs.readFileSync(path.join(os.homedir(), '.bash_history'), 'utf-8');
  } catch {
    // no bash history available (e.g. Windows, or history not saved) — not fatal
  }

  try {
    pipList = execSync('pip3 freeze', { cwd }).toString();
  } catch {
    try {
      pipList = execSync('pip freeze', { cwd }).toString();
    } catch {
      // pip not installed / not on PATH — not fatal
    }
  }

  try {
    npmList = execSync('npm list --depth=0', { cwd }).toString();
  } catch {
    // no package.json / npm not installed — not fatal
  }

  onProgress('Scanning project files...');

  try {
    const files = listFiles(cwd);
    for (const rel of files) {
      try {
        const content = fs.readFileSync(path.join(cwd, rel), 'base64');
        filesData.push({ path: rel, content });
      } catch {
        // unreadable file (permissions, broken symlink, etc.) — skip it
      }
    }
  } catch {
    // scanning failed entirely — return whatever we have
  }

  return { history, pipList, npmList, files: filesData };
}

/**
 * Split a file on disk into <=100MB chunks: <path>_part_00, _part_01, ...
 * Pure Node, replaces the Unix `split` command (not available on Windows).
 */
function splitFile(sourcePath, outDir, baseName, ext) {
  const buf = fs.readFileSync(sourcePath);
  const totalParts = Math.max(1, Math.ceil(buf.length / PART_SIZE));
  const finalFiles = [];
  for (let i = 0; i < totalParts; i++) {
    const chunk = buf.subarray(i * PART_SIZE, (i + 1) * PART_SIZE);
    const name = `${baseName}_part_${i + 1}_of_${totalParts}.${ext}.part`;
    const outPath = path.join(outDir, name);
    fs.writeFileSync(outPath, chunk);
    finalFiles.push({ name, path: outPath });
  }
  return finalFiles;
}

/**
 * Write the export bundle to disk, optionally as a zip and/or split into
 * <=100MB parts (useful when the browser download or transfer has a size cap).
 *
 * @param {object} opts
 * @param {ReturnType<typeof gatherExportData>} opts.exportData
 * @param {string} opts.outDir - directory to write output into
 * @param {string} [opts.baseName]
 * @param {boolean} [opts.zip]
 * @param {boolean} [opts.split]
 * @param {(msg: string) => void} [opts.onProgress]
 * @returns {Promise<{ name: string, path: string }[]>} the files that were produced
 */
export async function packageExportData({
  exportData,
  outDir,
  baseName = `smp_${Date.now()}`,
  zip = false,
  split = false,
  onProgress = () => {},
}) {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'export.json');
  fs.writeFileSync(jsonPath, JSON.stringify(exportData));

  onProgress('Packaging...');

  if (zip) {
    const jszip = new JSZip();
    jszip.file('export.json', JSON.stringify(exportData));
    const zipBuf = await jszip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const zipPath = path.join(outDir, `${baseName}.zip`);
    fs.writeFileSync(zipPath, zipBuf);

    if (split) {
      onProgress('Done.');
      return splitFile(zipPath, outDir, baseName, 'zip');
    }
    onProgress('Done.');
    return [{ name: `${baseName}.zip`, path: zipPath }];
  }

  if (split) {
    onProgress('Done.');
    return splitFile(jsonPath, outDir, baseName, 'json');
  }

  onProgress('Done.');
  return [{ name: `${baseName}.json`, path: jsonPath }];
}

/**
 * Restore a previously exported bundle: append bash history, reinstall pip
 * packages, and write project files back to disk.
 *
 * @param {object} opts
 * @param {string} opts.jsonPath - path to an export.json (already extracted if it came from a zip)
 * @param {string} [opts.targetDir] - where to restore project files (default: process.cwd())
 * @param {(msg: string) => void} [opts.onProgress]
 */
export function importExportData({ jsonPath, targetDir = process.cwd(), onProgress = () => {} }) {
  const exportData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  if (exportData.history) {
    try {
      fs.appendFileSync(path.join(os.homedir(), '.bash_history'), '\n' + exportData.history);
      onProgress('Restored bash history.');
    } catch (e) {
      onProgress(`Warning: could not restore bash history: ${e.message}`);
    }
  }

  if (exportData.pipList) {
    const reqPath = path.join(path.dirname(jsonPath), 'requirements.txt');
    fs.writeFileSync(reqPath, exportData.pipList);
    onProgress('Reinstalling pip packages...');
    try {
      execSync(`pip3 install -r "${reqPath}" --break-system-packages`);
      onProgress('Pip packages restored.');
    } catch (e) {
      try {
        execSync(`pip install -r "${reqPath}"`);
        onProgress('Pip packages restored.');
      } catch (e2) {
        onProgress(`Warning: pip restore failed: ${e2.message}`);
      }
    }
  }

  if (exportData.files) {
    onProgress('Restoring files...');
    for (const f of exportData.files) {
      const destPath = path.join(targetDir, ...f.path.split('/'));
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, Buffer.from(f.content, 'base64'));
    }
    onProgress(`Restored ${exportData.files.length} files.`);
  }

  onProgress('Done importing!');
  return exportData;
}
