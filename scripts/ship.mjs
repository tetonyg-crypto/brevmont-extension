#!/usr/bin/env node
/**
 * scripts/ship.mjs
 *
 * One command = build + Desktop sync + ZIP + API public sync.
 *
 *   npm run ship
 *
 * Replaces the multi-step shuffle that's caused version chaos. The ONLY
 * canonical Desktop folder is C:\Users\Yancy\Desktop\brevmont-extension.
 * Every ship pass nukes and re-fills that folder so it can never be
 * stale relative to the build.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const BUILD_DIR = resolve(REPO_ROOT, '.output/chrome-mv3');
const ZIP_PATH = resolve(REPO_ROOT, 'brevmont-extension-latest.zip');
const DESKTOP_FOLDER = 'C:\\Users\\Yancy\\Desktop\\brevmont-extension';
const API_PUBLIC_ZIP = 'C:\\Users\\Yancy\\brevmont-api\\public\\brevmont-extension-latest.zip';

const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;

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

log('1/5', `Building wxt → .output/chrome-mv3 (target version: v${VERSION})`);
run('npx', ['wxt', 'build']);

log('2/5', `Syncing build → ${DESKTOP_FOLDER}`);
if (existsSync(DESKTOP_FOLDER)) {
  rmSync(DESKTOP_FOLDER, { recursive: true, force: true });
}
mkdirSync(DESKTOP_FOLDER, { recursive: true });
cpSync(BUILD_DIR, DESKTOP_FOLDER, { recursive: true });

log('3/5', `Verifying Desktop manifest matches v${VERSION}`);
const desktopManifest = JSON.parse(readFileSync(join(DESKTOP_FOLDER, 'manifest.json'), 'utf8'));
if (desktopManifest.version !== VERSION) {
  console.error(`[ship] manifest version drift: package.json=${VERSION} desktop=${desktopManifest.version}`);
  process.exit(1);
}

log('4/5', `Zipping → ${ZIP_PATH}`);
run('powershell', [
  '-NoProfile',
  '-Command',
  `Compress-Archive -Path '${BUILD_DIR}\\*' -DestinationPath '${ZIP_PATH}' -Force`,
]);

log('5/5', `Copying ZIP → ${API_PUBLIC_ZIP}`);
cpSync(ZIP_PATH, API_PUBLIC_ZIP);

console.log(`\n[ship] DONE. v${VERSION} is live at:
  Desktop folder: ${DESKTOP_FOLDER}
  Zip (repo):     ${ZIP_PATH}
  Zip (API):      ${API_PUBLIC_ZIP}

Founder: chrome://extensions → reload Brevmont (or remove + Load Unpacked from Desktop folder).
Watch Telegram for "🔌 Brevmont extension installed/update: v${VERSION}".
`);
