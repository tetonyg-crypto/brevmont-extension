#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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
if (permissions.includes('notifications')) failures.push('notifications permission is present');
if (hosts.includes('<all_urls>')) failures.push('<all_urls> host permission is present');
const BROAD_MATCHES = new Set(['http://*/*', 'https://*/*', '<all_urls>']);
for (const cs of manifest.content_scripts || []) {
  for (const m of cs.matches || []) {
    if (BROAD_MATCHES.has(m)) failures.push(`content script has broad match pattern: ${m}`);
  }
}

if (failures.length) {
  console.error('[cws-zip] Invalid Chrome Web Store package:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

copyFileSync(wxtZip, cwsZip);
console.log(`[cws-zip] Ready for Chrome Web Store upload: ${cwsZip}`);
