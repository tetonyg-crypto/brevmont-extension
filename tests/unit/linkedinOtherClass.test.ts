import { describe, expect, test } from 'vitest';
import { linkedInBubbleDirection } from '../../entrypoints/lib/leadContextScan';

// Structure observed on the live LinkedIn messaging page (2026-09-26): each
// .msg-s-message-list__event wraps a .msg-s-event-listitem; the other
// participant's items carry msg-s-event-listitem--other.
function thread(html: string) {
  document.body.innerHTML = `<ul class="msg-s-message-list-content">${html}</ul>`;
  return Array.from(document.querySelectorAll('.msg-s-message-list__event')) as HTMLElement[];
}

describe('LinkedIn direction from the --other class', () => {
  test('works even when both participants share a name', () => {
    const [mine, theirs] = thread(`
      <li class="msg-s-message-list__event"><span class="msg-s-message-group__name">Yancy Garcia</span>
        <div class="msg-s-event-listitem msg-s-event-listitem--last-in-group"><p class="msg-s-event-listitem__body">Just sent the proposal over</p></div></li>
      <li class="msg-s-message-list__event"><span class="msg-s-message-group__name">Yancy Garcia</span>
        <div class="msg-s-event-listitem msg-s-event-listitem--last-in-group msg-s-event-listitem--other"><p class="msg-s-event-listitem__body">Thanks, reviewing it tonight</p></div></li>`);
    expect(linkedInBubbleDirection(mine, mine.textContent || '', 'Yancy Garcia', null).direction).toBe('outbound');
    expect(linkedInBubbleDirection(theirs, theirs.textContent || '', 'Yancy Garcia', null).direction).toBe('inbound');
  });
});
