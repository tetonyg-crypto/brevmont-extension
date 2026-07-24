#!/usr/bin/env node
/**
 * scripts/ship.mjs
 *
 * One command = build + Desktop sync + stale Desktop cleanup + ZIP + API public sync.
 *
 *   npm run ship
 *
 * Replaces the multi-step shuffle that's caused version chaos. The ONLY
 * Desktop folder Yancy should load is the visible versioned folder:
 * ~/Desktop/Brevmont-<version>-UNPACKED on macOS.
 * Every ship pass deletes stale Brevmont extension Desktop builds and
 * re-fills the current versioned folder.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
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
const DESKTOP_DIR = IS_WINDOWS
  ? 'C:\\Users\\Yancy\\Desktop'
  : join(HOME, 'Desktop');
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
// Self-hosted update channel (policy-managed installs). Chrome pulls the
// signed CRX straight from the API, so an internal ship reaches installed
// machines with no Chrome Web Store involvement. The product version stays
// pinned; the 4th segment is the channel build counter Chrome compares.
const API_PUBLIC_CRX = join(API_ROOT, 'public', 'brevmont-extension.crx');
const API_PUBLIC_UPDATE_XML = join(API_ROOT, 'public', 'brevmont-extension-update.xml');
const CRX_CHANNEL_ID = 'nfjpfhmboehhcplpgepcoeblbfpmdkji';
const CRX_KEY_PATH = join(HOME, 'Projects', 'brevmont-vault', 'infrastructure', 'secrets', 'extension-keypair.pem');
const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
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

function assertVerificationBridge(manifest, label) {
  const scripts = Array.isArray(manifest?.content_scripts) ? manifest.content_scripts : [];
  const bridge = scripts.find((entry) => {
    const js = Array.isArray(entry?.js) ? entry.js : [];
    return js.includes('content-scripts/verification-bridge.js');
  });
  if (!bridge) {
    console.error(`[ship] ${label} is missing content-scripts/verification-bridge.js.`);
    console.error('[ship] Refusing to ship because live capture tooling would be blind on the loaded page.');
    process.exit(1);
  }
  if (bridge.world !== 'MAIN') {
    console.error(`[ship] ${label} verification bridge must run in MAIN world, got ${bridge.world || 'default isolated world'}.`);
    process.exit(1);
  }
}

function isStaleDesktopExtensionBuild(entryName) {
  if (entryName === `Brevmont-${VERSION}-UNPACKED`) return false;
  return (
    /^Brevmont-\d+\.\d+\.\d+-UNPACKED$/i.test(entryName) ||
    /^Brevmont-\d+\.\d+\.\d+\.zip$/i.test(entryName) ||
    /^brevmont-extension$/i.test(entryName) ||
    /^brevmont-extension-\d+\.\d+\.\d+-chrome-web-store\.zip$/i.test(entryName) ||
    /^!?BREVMONT-.*UPLOAD-TO-CWS\.zip$/i.test(entryName) ||
    /^UPLOAD-TO-CWS\.zip$/i.test(entryName)
  );
}

function cleanDesktopExtensionBuilds() {
  if (!existsSync(DESKTOP_DIR)) return;
  for (const entry of readdirSync(DESKTOP_DIR)) {
    if (!isStaleDesktopExtensionBuild(entry)) continue;
    const target = join(DESKTOP_DIR, entry);
    console.log(`[ship] Removing stale Desktop extension artifact -> ${target}`);
    rmSync(target, { recursive: true, force: true });
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

log('2/6', `Cleaning stale Desktop builds and syncing -> ${DESKTOP_VERSIONED_FOLDER}`);
cleanDesktopExtensionBuilds();
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
  ].join('\n')
);

log('3/6', `Verifying Desktop manifest matches v${VERSION}`);
const desktopVersionedManifest = JSON.parse(readFileSync(join(DESKTOP_VERSIONED_FOLDER, 'manifest.json'), 'utf8'));
if (desktopVersionedManifest.version !== VERSION) {
  console.error(`[ship] versioned Desktop manifest drift: package.json=${VERSION} desktop=${desktopVersionedManifest.version}`);
  process.exit(1);
}
assertVerificationBridge(desktopVersionedManifest, 'Desktop manifest');

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

function publishCrxChannel() {
  if (IS_WINDOWS || !existsSync(CRX_KEY_PATH) || !existsSync(CHROME_BIN)) {
    console.log('\n[ship] CRX channel skipped (needs macOS Chrome + vault signing key).');
    return;
  }
  log('7/7', 'Packing signed CRX for the self-hosted update channel');
  const stage = resolve(REPO_ROOT, '.output/crx-stage');
  rmSync(stage, { recursive: true, force: true });
  cpSync(BUILD_DIR, stage, { recursive: true });

  // Chrome only updates when the version string increases, while the product
  // version stays pinned to the CWS-matching number. A 4th segment carries
  // the channel build counter.
  let counter = 1;
  try {
    const xml = existsSync(API_PUBLIC_UPDATE_XML) ? readFileSync(API_PUBLIC_UPDATE_XML, 'utf8') : '';
    const m = xml.match(/<updatecheck[^>]*version='([\d.]+)'/);
    if (m) {
      const parts = m[1].split('.');
      if (parts.slice(0, 3).join('.') === VERSION) counter = Number(parts[3] || 0) + 1;
    }
  } catch { /* first publish */ }
  const channelVersion = `${VERSION}.${counter}`;

  const stageManifestPath = join(stage, 'manifest.json');
  const stageManifest = JSON.parse(readFileSync(stageManifestPath, 'utf8'));
  stageManifest.version = channelVersion;
  stageManifest.update_url = 'https://api.brevmont.com/api/extension-update.xml';
  writeFileSync(stageManifestPath, JSON.stringify(stageManifest, null, 2));

  rmSync(`${stage}.crx`, { force: true });
  run(`"${CHROME_BIN}"`, ['--no-sandbox', `--pack-extension="${stage}"`, `--pack-extension-key="${CRX_KEY_PATH}"`]);
  if (!existsSync(`${stage}.crx`)) {
    console.error('[ship] FAILED: Chrome did not produce a CRX');
    process.exit(1);
  }
  cpSync(`${stage}.crx`, API_PUBLIC_CRX);
  writeFileSync(API_PUBLIC_UPDATE_XML, `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${CRX_CHANNEL_ID}'>
    <updatecheck codebase='https://api.brevmont.com/api/extension-crx' version='${channelVersion}' />
  </app>
</gupdate>
`);
  console.log(`[ship] CRX channel published: ${channelVersion} -> ${API_PUBLIC_CRX}`);
}

log('6/6', `Copying ZIP + manifest -> ${join(API_ROOT, 'public')}`);
assertApiTarget();
assertVersionCanShip(buildManifest);
cpSync(ZIP_PATH, API_PUBLIC_ZIP);
cpSync(MANIFEST_PATH, API_PUBLIC_MANIFEST);
verifyLiveManifest(buildManifest);

publishCrxChannel();

console.log(`\n[ship] DONE. v${VERSION} is live at:
  Desktop folder: ${DESKTOP_VERSIONED_FOLDER}
  Desktop marker: ${DESKTOP_MARKER}
  Zip (repo):     ${ZIP_PATH}
  Zip (API):      ${API_PUBLIC_ZIP}
  Manifest:       ${API_PUBLIC_MANIFEST}

Founder: chrome://extensions → remove old Brevmont loads, then Load Unpacked from the Desktop folder above.
Watch Telegram for "🔌 Brevmont extension installed/update: v${VERSION}".
`);
