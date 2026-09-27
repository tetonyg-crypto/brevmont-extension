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

  it('filters hidden and aria-hidden nodes in the shared fallback walker', () => {
    const scan = readFileSync(resolve(process.cwd(), 'entrypoints/lib/leadContextScan.ts'), 'utf8');
    expect(scan).toContain("el.getAttribute('aria-hidden') === 'true'");
    expect(scan).toContain("style.display === 'none' || style.visibility === 'hidden'");
  });

  it('invalidates an in-flight scan when the SPA switches conversations', () => {
    expect(sidepanel).toContain('autoThreadScanRequestId++;');
    expect(sidepanel).toContain('if (scanUrl && currentPlatform.url && scanUrl !== currentPlatform.url) return null;');
  });

  it('falls back to the legacy LinkedIn scan when the adapter returns no identity', () => {
    expect(sidepanel).toContain('const profileScanMissingName = linkedInProfile && !(');
    expect(sidepanel).toContain('const initialProfileMissingName = initialLinkedInProfile && !(');
    expect(sidepanel).toContain('if ((!ctx || ctx.ok === false || profileScanMissingName) && !facebookStrict)');
  });
});
