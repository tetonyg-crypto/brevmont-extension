import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test.describe('streaming output cleanup guards', () => {
  test('sidepanel removes the streaming placeholder on success and failure paths', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'entrypoints/sidepanel/main.ts'), 'utf8');
    expect(source).toContain('function removeStreamingOutput');
    expect(source).toContain('} finally {');
    expect(source).toContain('removeStreamingOutput(root, _generationId);');
    expect(source).toContain("msg.event === 'error'");
    expect(source).toContain("addOutput(root, 'Error', GENERATION_FAILURE_MESSAGE)");
  });
});
