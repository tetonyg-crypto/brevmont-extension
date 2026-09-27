import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const contentSource = readFileSync(resolve(process.cwd(), 'entrypoints/content.ts'), 'utf8');

describe('Facebook identity routing', () => {
  it('uses the Facebook adapter as the only identity source during lead scans', () => {
    expect(contentSource).toContain('const detected = isFacebook ? null : await detectCustomerFromPage();');
    expect(contentSource).toContain('const clean = platforms.pickCleanName(isFacebook');
    expect(contentSource).toContain('? [adapterName]');
  });

  it('does not merge legacy Facebook conversation or generic page-name fallbacks', () => {
    const scanStart = contentSource.indexOf("if (msg.type === 'SCAN_LEAD_V2')");
    const scanEnd = contentSource.indexOf("if (msg.type === 'INJECT_CONTENT_V2')", scanStart);
    const scanHandler = contentSource.slice(scanStart, scanEnd);

    expect(scanHandler).not.toContain('extractFacebookConversationName()');
    expect(scanHandler).not.toContain("raw_source: 'legacy_fb_conversation'");
    expect(scanHandler).toContain('safeExtractContactName && !nameMatchesGmailSubject');
  });

  it('requires a stable Facebook profile identity across consecutive reads', () => {
    expect(contentSource).toContain('async function confirmFacebookProfileIdentity');
    expect(contentSource).toContain("startsWith('fb_profile:')");
    expect(contentSource).toContain('previousName && previousName === nextName');
  });
});
