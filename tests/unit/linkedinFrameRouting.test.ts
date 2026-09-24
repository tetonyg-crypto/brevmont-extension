import { describe, expect, it } from 'vitest';
import {
  probeLinkedInConversationDocument,
  scoreLinkedInFrame,
  selectLinkedInConversationFrame,
  type LinkedInFrameProbe,
} from '../../entrypoints/lib/linkedinFrameRouting';

function probe(frameId: number, overrides: Partial<LinkedInFrameProbe> = {}): LinkedInFrameProbe {
  const scored = scoreLinkedInFrame({
    href: overrides.href || `https://www.linkedin.com/frame-${frameId}`,
    hasThreadView: overrides.hasThreadView || false,
    messageListCount: overrides.messageListCount || 0,
    composerCount: overrides.composerCount || 0,
    visibleMessageCount: overrides.visibleMessageCount || 0,
  });
  return { frameId, ...scored, ...overrides };
}

describe('LinkedIn conversation frame routing', () => {
  it('selects the child frame with the actual conversation over top-page UI chrome', () => {
    const top = probe(0, { href: 'https://www.linkedin.com/messaging/thread/abc/' });
    const conversation = probe(7, {
      href: 'https://www.linkedin.com/preload/?_bprMode=vanilla',
      hasThreadView: true,
      messageListCount: 3,
      composerCount: 3,
      visibleMessageCount: 12,
    });
    expect(selectLinkedInConversationFrame([top, conversation])).toEqual(conversation);
  });

  it('does not qualify global navigation or profile chrome', () => {
    expect(selectLinkedInConversationFrame([
      probe(0, { href: 'https://www.linkedin.com/in/yancy-garcia/' }),
      probe(4, { composerCount: 1, visibleMessageCount: 8 }),
    ])).toBeNull();
  });

  it('returns null when no frame has a thread view or message list', () => {
    expect(selectLinkedInConversationFrame([probe(0), probe(2)])).toBeNull();
  });

  it('ranks valid frames deterministically by score, messages, then frame id', () => {
    const weaker = probe(9, { messageListCount: 1, visibleMessageCount: 3 });
    const strongerHighId = probe(8, { hasThreadView: true, messageListCount: 1, visibleMessageCount: 10 });
    const strongerLowId = probe(3, { hasThreadView: true, messageListCount: 1, visibleMessageCount: 10 });
    expect(selectLinkedInConversationFrame([weaker, strongerHighId, strongerLowId])?.frameId).toBe(3);
  });

  it('ignores UI chrome and recognizes a real conversation document', () => {
    document.body.innerHTML = '<h2>0 notifications</h2><button>Add section</button>';
    expect(probeLinkedInConversationDocument()).toMatchObject({
      hasMessagingSurface: false,
      score: 0,
    });
    document.body.innerHTML = `
      <section class="msg-conversations-container__thread-view">
        <div class="msg-s-message-list-content">
          <div class="msg-s-event-listitem">Inbound</div>
          <div class="msg-s-event-listitem">Outbound</div>
        </div>
        <div class="msg-form__contenteditable" contenteditable="true"></div>
      </section>
    `;
    expect(probeLinkedInConversationDocument()).toMatchObject({
      hasThreadView: true,
      messageListCount: 1,
      composerCount: 1,
      visibleMessageCount: 2,
      hasMessagingSurface: true,
      score: 222,
    });
  });
});
