import { beforeEach, describe, expect, it } from 'vitest';
import { isLinkedInMessagingSurface } from '../../entrypoints/lib/leadContextScan';

// 2026-09-26 regression: LinkedIn's persistent bottom-right messaging
// overlay (minimized chat-head bubbles, e.g. "Darrin Guttman") sits in the
// DOM on EVERY LinkedIn page, profile pages included. A bare
// document.querySelector for its markup (.msg-form__contenteditable,
// .msg-overlay-conversation-bubble, etc) misclassified every profile page
// as an open messaging thread, so the profile-specific name extraction
// branch never ran at all -- confirmed live: the "This for X?" chip showed
// nothing on a real profile page with the overlay present.
describe('isLinkedInMessagingSurface', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('is true on an actual /messaging/ URL regardless of DOM', () => {
    expect(isLinkedInMessagingSurface('https://www.linkedin.com/messaging/thread/abc/')).toBe(true);
  });

  it('is true when a real, visible open conversation pane is present', () => {
    document.body.innerHTML = `<div class="msg-s-message-list-content"><h2 class="msg-entity-lockup__entity-title">Tony Valladolid</h2></div>`;
    expect(isLinkedInMessagingSurface('https://www.linkedin.com/in/someone/')).toBe(true);
  });

  it('is false on a profile page even when a collapsed messaging overlay bubble exists in the DOM but is hidden', () => {
    document.body.innerHTML = `
      <div class="msg-overlay-conversation-bubble" style="display:none">
        <div class="msg-form__contenteditable" contenteditable="true"></div>
      </div>`;
    expect(isLinkedInMessagingSurface('https://www.linkedin.com/in/oleg-melnikov/')).toBe(false);
  });

  it('is false on a profile page with no messaging markup at all', () => {
    document.body.innerHTML = `<main><h1>Oleg Melnikov</h1></main>`;
    expect(isLinkedInMessagingSurface('https://www.linkedin.com/in/oleg-melnikov/')).toBe(false);
  });
});
