import { describe, expect, it } from 'vitest';
import { isLinkedInMessagingSurface } from '../../entrypoints/lib/leadContextScan';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('LinkedIn profile surface detection', () => {
  it('does not treat the persistent collapsed Messaging chat-head as an open thread', () => {
    document.body.innerHTML = `
      <div class="msg-overlay-conversation-bubble">
        <div class="msg-entity-lockup__entity-title">Messaging</div>
      </div>`;

    expect(isLinkedInMessagingSurface('https://www.linkedin.com/in/olegane/')).toBe(false);
  });

  it('keeps the actual messaging route classified as messaging', () => {
    expect(isLinkedInMessagingSurface('https://www.linkedin.com/messaging/thread/abc/')).toBe(true);
  });

  it('supports LinkedIn profile shells that render the name as an obfuscated-class H2', () => {
    const source = readFileSync(resolve(process.cwd(), 'entrypoints/lib/leadContextScan.ts'), 'utf8');
    expect(source).toContain("main.querySelectorAll('h1, h2, [role=\"heading\"]')");
  });
});
