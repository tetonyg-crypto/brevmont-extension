import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(__dirname, '../../entrypoints/onboarding/main.ts'),
  'utf8',
);

// PROFILE-SYNC-404: the onboarding wizard's profile sync must hit the real,
// live API route (PATCH /api/v1/rep/profile), never the dead /api/rep-profile
// route that 404s silently (wrapped in try/catch as best-effort).
describe('onboarding profile sync endpoint', () => {
  it('PATCHes the real /api/v1/rep/profile route, not the dead /api/rep-profile route', () => {
    expect(source).toContain('`${PROXY_URL}/api/v1/rep/profile`');
    expect(source).toContain("method: 'PATCH'");
    // No live fetch call may target the dead route (a comment naming it
    // as the bug being fixed is fine).
    expect(source).not.toMatch(/fetch\(`\$\{PROXY_URL\}\/api\/rep-profile`/);
    expect(source).toContain('buildRepProfileSyncBody(profile)');
  });
});
