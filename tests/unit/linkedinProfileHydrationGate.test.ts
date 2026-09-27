import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('LinkedIn profile hydration gate', () => {
  const sidepanel = readFileSync(resolve(process.cwd(), 'entrypoints/sidepanel/main.ts'), 'utf8');
  const adapter = readFileSync(resolve(process.cwd(), 'entrypoints/lib/platforms/linkedin.ts'), 'utf8');

  it('treats every /in/ URL as a profile capture and rejects nameless snapshots', () => {
    expect(sidepanel).toContain("/linkedin\\.com\\/in\\//i.test(");
    expect(sidepanel).toContain('if (isLinkedIn && isProfileCapture && !customerName) return null;');
    expect(sidepanel).toContain("if (isLinkedInProfile && !String(detectedName || '').trim())");
  });

  it('retries LinkedIn profiles while the SPA heading hydrates', () => {
    expect(sidepanel).toContain('const linkedInProfile = platformId === \'linkedin\'');
    expect(sidepanel).toContain('const attempts = flakyDom ? 5 : (force ? 2 : 1);');
  });

  it('uses visible profile innerText instead of a hidden-node text walk', () => {
    expect(adapter).toContain('const visibleProfileText = String(profileMain?.innerText || \'\')');
    expect(adapter).toContain('const bodyText = String(main?.innerText || \'\')');
  });
});
