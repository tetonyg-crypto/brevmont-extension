import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const root = process.cwd();

test('install screen hands first-time users to the app setup page', () => {
  const html = readFileSync(resolve(root, 'entrypoints/install-screen/index.html'), 'utf8');
  const main = readFileSync(resolve(root, 'entrypoints/install-screen/main.ts'), 'utf8');

  expect(html).toContain('Pin Brevmont, then choose your setup path.');
  expect(html).toContain('Open setup page');
  expect(html).toContain('pick your industry and create your account');
  expect(main).toContain('BREVMONT_WELCOME_URL');
  expect(main).not.toContain("https://app.brevmont.com/auth/extension");
});

