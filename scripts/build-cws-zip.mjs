#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const outDir = resolve(root, '.output');
const manifestPath = resolve(root, '.output', 'chrome-mv3', 'manifest.json');
const wxtZip = resolve(outDir, `brevmont-extension-${pkg.version}-chrome.zip`);
const cwsZip = resolve(outDir, `brevmont-extension-${pkg.version}-chrome-web-store.zip`);

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    env: { ...process.env, CHROME_WEB_STORE_BUILD: '1' },
    shell: true,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

if (existsSync(resolve(root, '.output', 'chrome-mv3'))) {
  rmSync(resolve(root, '.output', 'chrome-mv3'), { recursive: true, force: true });
}
mkdirSync(outDir, { recursive: true });

run('npx', ['wxt', 'zip']);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const permissions = manifest.permissions || [];
const hosts = manifest.host_permissions || [];
const failures = [];
if ('key' in manifest) failures.push('manifest.key is present');
if (manifest.action?.default_popup) failures.push('action.default_popup points at the retired generic popup');
if (manifest.side_panel?.default_path !== 'sidepanel.html') failures.push('side_panel.default_path is not sidepanel.html');
// notifications: required for Overdrive escalation desktop alerts and
// documented in the CWS submission kit's 02-permission-justifications.md.
// Reviewer sees an explicit "why" string, no surprise.
if (hosts.includes('<all_urls>')) failures.push('<all_urls> host permission is present');
const BROAD_MATCHES = new Set(['http://*/*', 'https://*/*', '<all_urls>']);
for (const cs of manifest.content_scripts || []) {
  for (const m of cs.matches || []) {
    if (BROAD_MATCHES.has(m)) failures.push(`content script has broad match pattern: ${m}`);
    if (/localhost|127\.0\.0\.1/i.test(m)) failures.push(`content script has localhost match: ${m}`);
  }
}
for (const m of manifest.externally_connectable?.matches || []) {
  if (/localhost|127\.0\.0\.1/i.test(m)) failures.push(`externally_connectable has localhost match: ${m}`);
}

const chunksDir = resolve(root, '.output', 'chrome-mv3', 'chunks');
const sidepanelChunk = existsSync(chunksDir)
  ? readdirSync(chunksDir).find((name) => /^sidepanel-.*\.js$/.test(name))
  : null;
if (!sidepanelChunk) {
  failures.push('full sidepanel bundle is missing');
} else {
  const sidepanelSource = readFileSync(resolve(chunksDir, sidepanelChunk), 'utf8');
  for (const requiredControl of ['+ Lead', 'My Leads', 'Coach', 'My Stats', 'Settings']) {
    if (!sidepanelSource.includes(requiredControl)) failures.push(`full workspace control is missing: ${requiredControl}`);
  }
}

if (failures.length) {
  console.error('[cws-zip] Invalid Chrome Web Store package:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

function stripUnderscoreZipEntries(zipPath) {
  const listed = spawnSync('zipinfo', ['-1', zipPath], { encoding: 'utf8' });
  if (listed.status !== 0) {
    console.error('[cws-zip] Could not list zip entries');
    process.exit(1);
  }
  const banned = listed.stdout.split(/\r?\n/).filter((name) => {
    const base = name.split('/').pop() || name;
    return name && (base.startsWith('_') || name.split('/').some((part) => part.startsWith('_')));
  });
  for (const name of banned) {
    const removed = spawnSync('zip', ['-d', zipPath, name], { encoding: 'utf8' });
    if (removed.status !== 0) {
      console.error(`[cws-zip] Could not remove ${name} from the store zip`);
      process.exit(1);
    }
    console.log(`[cws-zip] Removed underscore entry: ${name}`);
  }
}

copyFileSync(wxtZip, cwsZip);
stripUnderscoreZipEntries(cwsZip);
console.log(`[cws-zip] Ready for Chrome Web Store upload: ${cwsZip}`);
