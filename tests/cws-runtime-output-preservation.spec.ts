import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('CWS packaging preserves the stable-id unpacked runtime build', () => {
  const source = readFileSync(resolve(process.cwd(), 'scripts/build-cws-zip.mjs'), 'utf8');
  expect(source).toContain("const runtimeBackupDir = resolve(root, '.output', '.chrome-mv3-runtime-backup')");
  expect(source).toContain("process.on('exit', restoreRuntimeBuild)");
  expect(source).toContain('renameSync(runtimeDir, runtimeBackupDir)');
  expect(source).toContain('renameSync(runtimeBackupDir, runtimeDir)');
  expect(source.indexOf('restoreRuntimeBuild();')).toBeLessThan(source.indexOf('[cws-zip] Ready for Chrome Web Store upload'));
});
