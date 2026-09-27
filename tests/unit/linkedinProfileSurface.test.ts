import { describe, expect, it } from 'vitest';
import { isLinkedInMessagingSurface } from '../../entrypoints/lib/leadContextScan';

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
});
