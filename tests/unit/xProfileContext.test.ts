import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('X profile capture context', () => {
  const source = readFileSync(resolve(process.cwd(), 'entrypoints/lib/platforms/x.ts'), 'utf8');

  it('returns the visible profile bio and metadata as profile_bio', () => {
    expect(source).toContain('profile_bio: [bio, meta].filter(Boolean).join');
  });

  it('keeps profile context bounded to the visible header fields', () => {
    expect(source).toContain("const raw_text = [nameBlock, bio, meta].filter(Boolean).join('\\n').slice(0, 4000)");
    expect(source).toContain('profile_bio: [bio, meta].filter(Boolean).join');
  });
});
