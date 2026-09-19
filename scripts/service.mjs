#!/usr/bin/env node
/**
 * The local indexer, from a clean machine to a packaged executable.
 *
 *   node scripts/service.mjs venv            create services/indexer/.venv
 *   node scripts/service.mjs install [--full]  install requirements into it
 *   node scripts/service.mjs dev             run it on 127.0.0.1:8765
 *   node scripts/service.mjs build           freeze it into src-tauri/resources/indexer
 *
 * Why this file exists rather than three pip commands in the README:
 *
 *   * Python is frequently installed but not on PATH — on Windows the only
 *     `python` on PATH is often the Microsoft Store stub, which prints "Python
 *     was not found" when a script runs it. So Python is located by searching,
 *     and the interpreter that is actually found is the one used everywhere.
 *   * The indexer's dependencies are split into a light set (OCR, PDF text,
 *     vector index — a few hundred MB) and a heavy set (torch and friends, which
 *     is multiple GB). `install` takes the light set by default, because that is
 *     what a 16GB laptop should be asked to download, and `--full` opts in.
 *   * The packaged build has to land somewhere Tauri will ship it from, with the
 *     name the Rust supervisor looks for. That path is encoded here once.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serviceDir = join(root, 'services', 'indexer');
const venvDir = join(serviceDir, '.venv');
const isWindows = process.platform === 'win32';
const venvPython = isWindows
  ? join(venvDir, 'Scripts', 'python.exe')
  : join(venvDir, 'bin', 'python3');

const FULL_PACKAGES = ['sentence-transformers', 'torch', 'open-clip-torch', 'transformers'];
const LIGHT_REQUIREMENTS = [
  'fastapi>=0.115',
  'uvicorn[standard]>=0.32',
  'pydantic>=2.9',
  'numpy>=1.26',
  'opencv-python-headless>=4.10',
  'pillow>=10.4',
  'rapidocr-onnxruntime>=1.3',
  'pymupdf>=1.24',
  'sqlite-vec>=0.1.6',
];

/** Optional packages the freezer should carry with it when they are present. */
const COLLECT = [
  'rapidocr_onnxruntime',
  'onnxruntime',
  'cv2',
  'fitz',
  'sqlite_vec',
  'sentence_transformers',
  'transformers',
  'open_clip',
  'faiss',
];

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function run(program, args, options = {}) {
  return spawnSync(program, args, { stdio: 'inherit', ...options });
}

/**
 * Find a real Python 3.11+.
 *
 * `py -3` first (the Windows launcher, which resolves the registry rather than
 * PATH), then PATH, then the per-user install directories, which is where the
 * Windows installer puts a Python whose PATH entry was not ticked.
 */
function findPython() {
  const candidates = [];

  if (isWindows) {
    const localApps = process.env.LOCALAPPDATA;
    if (localApps) {
      for (const dir of ['Programs\\Python', 'Programs\\Python\\Shared']) {
        const base = join(localApps, dir);
        if (!existsSync(base)) continue;
        for (const entry of readdirSync(base)) {
          const exe = join(base, entry, 'python.exe');
          if (existsSync(exe)) candidates.push({ program: exe, args: [] });
        }
      }
    }
    candidates.push({ program: 'py', args: ['-3'] });
  }

  candidates.push({ program: isWindows ? 'python' : 'python3', args: [] });
  candidates.push({ program: 'python', args: [] });

  for (const candidate of candidates) {
    const probe = spawnSync(candidate.program, [...candidate.args, '-c', 'import sys; print(sys.version_info[:2])'], {
      encoding: 'utf8',
    });
    if (probe.status !== 0) continue;
    const text = (probe.stdout ?? '').trim();
    if (text.includes('was not found')) continue; // the Store stub
    const [major, minor] = text.replace(/[()]/g, '').split(',').map((part) => Number(part.trim()));
    if (major < 3 || (major === 3 && minor < 10)) continue;
    return { ...candidate, version: `${major}.${minor}` };
  }

  return null;
}

function requirePython() {
  const python = findPython();
  if (!python) {
    fail(
      'No Python 3.10+ found. Install one, then re-run:\n' +
        '    winget install Python.Python.3.12',
    );
  }
  return python;
}

function venvOrFail() {
  if (!existsSync(venvPython)) {
    fail(
      'The indexer virtual environment does not exist yet. Create it first:\n' +
        '    npm run service:venv\n' +
        '    npm run service:install',
    );
  }
  return venvPython;
}

function createVenv() {
  const python = requirePython();
  console.log(`\n  Using Python ${python.version} (${python.program})\n`);
  if (existsSync(venvDir)) {
    console.log('  .venv already exists — leaving it alone.\n');
    return;
  }
  const result = run(python.program, [...python.args, '-m', 'venv', venvDir]);
  if (result.status !== 0) fail('Could not create the virtual environment.');
  console.log(`\n  Created ${venvDir}\n`);
}

function install(full) {
  const python = venvOrFail();
  run(python, ['-m', 'pip', 'install', '--upgrade', 'pip', '--quiet']);

  const packages = full
    ? null // the requirements file, which includes the heavy extras
    : LIGHT_REQUIREMENTS;

  console.log(
    full
      ? '\n  Installing the full stack: OCR, PyMuPDF, embeddings and the vector index.\n' +
          '  torch alone is a ~2GB download.\n'
      : '\n  Installing the light stack: OCR, PDF text and the vector index, without torch.\n' +
          '  Add `--full` for embeddings and generated titles.\n',
  );

  const args = packages
    ? ['-m', 'pip', 'install', ...packages]
    : ['-m', 'pip', 'install', '-r', join(serviceDir, 'requirements.txt')];

  const result = run(python, args);
  if (result.status !== 0) fail('pip failed. The indexer will run without the packages that did not install.');

  console.log('\n  Done. Check what the service can do with:\n    npm run service:dev\n');
}

function dev() {
  const python = venvPython;
  if (!existsSync(python)) {
    // Fall back to a system Python so `npm run service:dev` still tells the user
    // what is missing rather than doing nothing.
    const fallback = requirePython();
    console.log('\n  No virtual environment found — running with the system Python.\n');
    run(fallback.program, [
      ...fallback.args,
      '-m',
      'uvicorn',
      'app.main:app',
      '--host',
      '127.0.0.1',
      '--port',
      '8765',
      '--app-dir',
      serviceDir,
    ]);
    return;
  }
  run(python, [
    '-m',
    'uvicorn',
    'app.main:app',
    '--host',
    '127.0.0.1',
    '--port',
    '8765',
    '--app-dir',
    serviceDir,
  ]);
}

/**
 * Freeze the service into a single executable.
 *
 * The artifact lands in `src-tauri/resources/indexer/`, which
 * `src-tauri/tauri.conf.json` ships as a resource and `supervisor.rs` looks in
 * before it checks for a virtual environment. So the order is: build this once,
 * then `npm run tauri:build`, and the installer carries a working indexer.
 */
function build() {
  const python = venvOrFail();
  const resourcesDir = join(root, 'src-tauri', 'resources', 'indexer');
  mkdirSync(resourcesDir, { recursive: true });

  const installedProbe = spawnSync(python, ['-m', 'pip', 'list', '--format=freeze'], {
    encoding: 'utf8',
  });
  const installed = new Set(
    (installedProbe.stdout ?? '')
      .split('\n')
      .map((line) => line.split('==')[0].trim().toLowerCase())
      .filter(Boolean),
  );

  const collectArgs = COLLECT.filter((name) => installed.has(name.toLowerCase())).flatMap((name) => [
    '--collect-all',
    name,
  ]);

  console.log(`\n  Freezing the indexer with: ${collectArgs.length / 2} package(s) collected.\n`);

  const result = run(python, [
    '-m',
    'PyInstaller',
    '--noconfirm',
    '--clean',
    '--onefile',
    '--name',
    'afterimage-indexer',
    '--distpath',
    resourcesDir,
    '--workpath',
    join(serviceDir, 'build', 'pyinstaller'),
    '--specpath',
    join(serviceDir, 'build'),
    ...collectArgs,
    join(serviceDir, 'serve.py'),
  ]);

  if (result.status !== 0) {
    fail(collectArgs.length === 0
      ? 'PyInstaller failed. Install it first: npm run service:install, then pip install pyinstaller.'
      : 'PyInstaller failed. See the output above.');
  }

  // PyInstaller leaves a build cache behind that must not be shipped.
  rmSync(join(serviceDir, 'build', 'pyinstaller'), { recursive: true, force: true });

  // A stable name for the supervisor: it looks for exactly this.
  const produced = join(resourcesDir, isWindows ? 'afterimage-indexer.exe' : 'afterimage-indexer');
  if (!existsSync(produced)) {
    const alt = existsSync(join(resourcesDir, 'afterimage-indexer'))
      ? join(resourcesDir, 'afterimage-indexer')
      : null;
    if (!alt) fail(`PyInstaller finished but no executable appeared in ${resourcesDir}`);
    if (isWindows) cpSync(alt, produced);
  }

  console.log(
    `\n  Packaged indexer:\n    ${produced}\n\n` +
      '  `npm run tauri:build` will now ship it, and the desktop app will start\n' +
      '  it automatically — no Python needed on the target machine.\n',
  );
}

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case 'venv':
    createVenv();
    break;
  case 'install':
    install(rest.includes('--full'));
    break;
  case 'dev':
    dev();
    break;
  case 'build':
    build();
    break;
  default:
    console.log(
      [
        '',
        '  Usage: node scripts/service.mjs <command>',
        '',
        '    venv                 create services/indexer/.venv',
        '    install [--full]     install the light stack, or everything with --full',
        '    dev                  run the service on 127.0.0.1:8765',
        '    build                freeze it into src-tauri/resources/indexer',
        '',
      ].join('\n'),
    );
}
