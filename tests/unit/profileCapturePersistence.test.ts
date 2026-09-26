import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

// Contract lock for profile captures across Instagram/X/Facebook/LinkedIn:
// adapter identity must survive content -> side panel -> local Dexie metadata
// -> server sync -> My Leads rendering. A prior implementation detected the
// URL in the adapter but dropped it before persistence.
describe('social profile lead capture persistence', () => {
  it('returns handle, profile URL, and profile capture mode from adapter scans', () => {
    const content = read('entrypoints/content.ts');
    expect(content).toContain("profile_url: clean?.profile_url || adapterCustomer?.profile_url || (captureMode ? window.location.href : null)");
    expect(content).toContain("username: clean?.username || adapterCustomer?.username || null");
    expect(content).toContain("const captureMode = isProfilePageRawSource(adapterCustomer?.raw_source) ? 'profile' : null");
    expect(content).toContain('thread_fingerprint: thread.conversation_key || null');
  });

  it('persists profile identity in lead metadata and keeps the DOM name authoritative', () => {
    const background = read('entrypoints/background.ts');
    expect(background).toContain("msg.payload?.capture_mode === 'profile'");
    expect(background).toContain('profile_url: msg.payload?.profile_url || null');
    expect(background).toContain('username: msg.payload?.username || null');
  });

  it('renders stored profiles as Prospect with a clickable profile link in My Leads', () => {
    const panel = read('entrypoints/sidepanel/main.ts');
    expect(panel).toContain("const isProspect = captureMode === 'profile'");
    expect(panel).toContain("target=\"_blank\" rel=\"noopener noreferrer\"");
    expect(panel).toContain("if (isProspectCapture) return 'Prospect'");
  });
});
