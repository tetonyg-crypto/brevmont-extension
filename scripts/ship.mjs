#!/usr/bin/env node
/**
 * scripts/ship.mjs
 *
 * One command = build + Desktop sync + ZIP + API public sync.
 *
 *   npm run ship
 *
 * Replaces the multi-step shuffle that's caused version chaos. The ONLY
 * canonical Desktop folder is ~/Desktop/brevmont-extension on macOS
 * (C:\Users\Yancy\Desktop\brevmont-extension on the retired Windows PC).
 * Every ship pass nukes and re-fills that folder so it can never be
 * stale relative to the build.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const BUILD_DIR = resolve(REPO_ROOT, '.output/chrome-mv3');
const ZIP_PATH = resolve(REPO_ROOT, 'brevmont-extension-latest.zip');
const MANIFEST_PATH = resolve(REPO_ROOT, 'brevmont-extension-manifest.json');
const IS_WINDOWS = process.platform === 'win32';
const HOME = homedir();
const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const DESKTOP_FOLDER = IS_WINDOWS
  ? 'C:\\Users\\Yancy\\Desktop\\brevmont-extension'
  : join(HOME, 'Desktop', 'brevmont-extension');
const DESKTOP_VERSIONED_FOLDER = IS_WINDOWS
  ? `C:\\Users\\Yancy\\Desktop\\Brevmont-${VERSION}-UNPACKED`
  : join(HOME, 'Desktop', `Brevmont-${VERSION}-UNPACKED`);
const DESKTOP_MARKER = IS_WINDOWS
  ? 'C:\\Users\\Yancy\\Desktop\\USE-THIS-BREVMONT-EXTENSION.txt'
  : join(HOME, 'Desktop', 'USE-THIS-BREVMONT-EXTENSION.txt');
const API_ROOT = IS_WINDOWS
  ? 'C:\\Users\\Yancy\\brevmont-api'
  : join(HOME, 'Projects', 'brevmont-api');
const API_PUBLIC_ZIP = join(API_ROOT, 'public', 'brevmont-extension-latest.zip');
const API_PUBLIC_MANIFEST = join(API_ROOT, 'public', 'brevmont-extension-manifest.json');
const FORCE = process.argv.includes('--force');
const VERIFY_LIVE = process.argv.includes('--verify-live') || process.env.VERIFY_LIVE_EXTENSION === '1';
let versionGateChecked = false;

function log(step, msg) {
  console.log(`\n[ship ${step}] ${msg}`);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: REPO_ROOT, shell: true, ...opts });
  if (r.status !== 0) {
    console.error(`\n[ship] FAILED: ${cmd} ${args.join(' ')} (exit ${r.status})`);
    process.exit(r.status || 1);
  }
}

function runCapture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8', shell: true, ...opts });
  if (r.status !== 0) return '';
  return String(r.stdout || '').trim();
}

function compareVersion(a, b) {
  const ap = String(a || '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const bp = String(b || '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(ap.length, bp.length); i += 1) {
    const diff = (ap[i] || 0) - (bp[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    console.error(`[ship] Could not parse ${filePath}: ${error.message}`);
    process.exit(1);
  }
}

function writeBuildManifest() {
  const manifest = {
    version: VERSION,
    checksum: `sha256:${sha256File(ZIP_PATH)}`,
    built_at: new Date().toISOString(),
    commit: runCapture('git', ['rev-parse', '--short', 'HEAD']) || 'unknown',
    filename: 'brevmont-extension-latest.zip',
    size_bytes: statSync(ZIP_PATH).size,
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function assertVersionCanShip(manifest) {
  if (versionGateChecked) return;
  const current = readJsonIfExists(API_PUBLIC_MANIFEST);
  if (!current) {
    console.log('[ship] No currently served manifest found. Proceeding with first manifest copy.');
    versionGateChecked = true;
    return;
  }

  console.log(`\n[ship] Current live: v${current.version || 'unknown'} (built ${current.built_at || 'unknown'}, commit ${current.commit || 'unknown'})`);
  console.log(`[ship] New build:    v${manifest.version} (built ${manifest.built_at}, commit ${manifest.commit})`);

  if (compareVersion(manifest.version, current.version) <= 0 && !FORCE) {
    console.error(`\n[ship] Refusing to overwrite v${current.version} with v${manifest.version}.`);
    console.error('[ship] Bump package.json version or rerun with --force if this is an intentional rebuild.');
    process.exit(1);
  }
  versionGateChecked = true;
}

function verifyLiveManifest(expected) {
  if (!VERIFY_LIVE) {
    console.log('\n[ship] Live endpoint verification skipped. After API deploy, run:');
    console.log('  npm run ship -- --verify-live');
    return;
  }

  const script = [
    "$r=Invoke-RestMethod -Uri 'https://api.brevmont.com/api/extension/version' -TimeoutSec 20",
    '$r | ConvertTo-Json -Compress',
  ].join('; ');
  const result = spawnSync('powershell', ['-NoProfile', '-Command', script], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: true,
  });
  if (result.status !== 0) {
    console.error('[ship] Live version check failed.');
    console.error(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }

  const live = JSON.parse(result.stdout);
  if (live.version === expected.version && live.checksum === expected.checksum) {
    console.log(`\n[ship] ✅ Extension v${expected.version} is live with matching checksum.`);
    return;
  }

  console.error('\n[ship] ❌ Version mismatch — deployed version does not match shipped version.');
  console.error(`[ship] Expected: v${expected.version} ${expected.checksum}`);
  console.error(`[ship] Live:     v${live.version} ${live.checksum}`);
  process.exit(1);
}

function assertApiTarget() {
  const packageJsonPath = join(API_ROOT, 'package.json');
  const serverPath = join(API_ROOT, 'server.ts');
  if (!existsSync(API_ROOT) || !existsSync(packageJsonPath) || !existsSync(serverPath)) {
    console.error(`[ship] API target is not the production repo: ${API_ROOT}`);
    console.error('[ship] Expected package.json and server.ts before copying the public extension ZIP.');
    process.exit(1);
  }

  const apiPkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (apiPkg.name !== 'brevmont-api') {
    console.error(`[ship] API target package name is ${apiPkg.name}; expected brevmont-api.`);
    process.exit(1);
  }

  const remote = spawnSync('git', ['-C', API_ROOT, 'remote', 'get-url', 'origin'], {
    encoding: 'utf8',
    shell: true,
  });
  const normalizedRemote = String(remote.stdout || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//, 'github.com/')
    .replace(/^git@github\.com:/, 'github.com/')
    .replace(/\.git$/, '');
  if (remote.status !== 0 || normalizedRemote !== 'github.com/tetonyg-crypto/brevmont-api') {
    console.error(`[ship] API target remote is ${normalizedRemote || 'unknown'}; expected github.com/tetonyg-crypto/brevmont-api.`);
    process.exit(1);
  }
}

assertApiTarget();
assertVersionCanShip({
  version: VERSION,
  built_at: 'pending build',
  commit: runCapture('git', ['rev-parse', '--short', 'HEAD']) || 'unknown',
});

log('1/6', `Building wxt -> .output/chrome-mv3 (target version: v${VERSION})`);
run('npx', ['wxt', 'build']);

log('2/6', `Syncing build -> ${DESKTOP_FOLDER}`);
if (existsSync(DESKTOP_FOLDER)) {
  rmSync(DESKTOP_FOLDER, { recursive: true, force: true });
}
mkdirSync(DESKTOP_FOLDER, { recursive: true });
cpSync(BUILD_DIR, DESKTOP_FOLDER, { recursive: true });

console.log(`[ship] Syncing visible versioned Desktop copy -> ${DESKTOP_VERSIONED_FOLDER}`);
if (existsSync(DESKTOP_VERSIONED_FOLDER)) {
  rmSync(DESKTOP_VERSIONED_FOLDER, { recursive: true, force: true });
}
mkdirSync(DESKTOP_VERSIONED_FOLDER, { recursive: true });
cpSync(BUILD_DIR, DESKTOP_VERSIONED_FOLDER, { recursive: true });
writeFileSync(
  DESKTOP_MARKER,
  [
    'Brevmont extension current unpacked build',
    `Version: ${VERSION}`,
    'Load this folder in chrome://extensions:',
    DESKTOP_VERSIONED_FOLDER,
    '',
    'Canonical source-of-truth folder:',
    DESKTOP_FOLDER,
    '',
  ].join('\n')
);

log('3/6', `Verifying Desktop manifest matches v${VERSION}`);
const desktopManifest = JSON.parse(readFileSync(join(DESKTOP_FOLDER, 'manifest.json'), 'utf8'));
if (desktopManifest.version !== VERSION) {
  console.error(`[ship] manifest version drift: package.json=${VERSION} desktop=${desktopManifest.version}`);
  process.exit(1);
}
const desktopVersionedManifest = JSON.parse(readFileSync(join(DESKTOP_VERSIONED_FOLDER, 'manifest.json'), 'utf8'));
if (desktopVersionedManifest.version !== VERSION) {
  console.error(`[ship] versioned Desktop manifest drift: package.json=${VERSION} desktop=${desktopVersionedManifest.version}`);
  process.exit(1);
}

log('4/6', `Zipping -> ${ZIP_PATH}`);
rmSync(ZIP_PATH, { force: true });
if (IS_WINDOWS) {
  run('powershell', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${BUILD_DIR}\\*' -DestinationPath '${ZIP_PATH}' -Force`,
  ]);
} else {
  run('zip', ['-qr', ZIP_PATH, '.'], { cwd: BUILD_DIR });
}

log('5/6', `Writing manifest -> ${MANIFEST_PATH}`);
const buildManifest = writeBuildManifest();

log('6/6', `Copying ZIP + manifest -> ${join(API_ROOT, 'public')}`);
assertApiTarget();
assertVersionCanShip(buildManifest);
cpSync(ZIP_PATH, API_PUBLIC_ZIP);
cpSync(MANIFEST_PATH, API_PUBLIC_MANIFEST);
verifyLiveManifest(buildManifest);

console.log(`\n[ship] DONE. v${VERSION} is live at:
  Desktop folder: ${DESKTOP_FOLDER}
  Desktop visible: ${DESKTOP_VERSIONED_FOLDER}
  Desktop marker:  ${DESKTOP_MARKER}
  Zip (repo):     ${ZIP_PATH}
  Zip (API):      ${API_PUBLIC_ZIP}
  Manifest:       ${API_PUBLIC_MANIFEST}

Founder: chrome://extensions → reload Brevmont (or remove + Load Unpacked from the visible Desktop folder).
Watch Telegram for "🔌 Brevmont extension installed/update: v${VERSION}".
`);
