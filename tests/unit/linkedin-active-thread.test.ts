import { describe, expect, it } from 'vitest';
import {
  extractLinkedInThreadCustomer,
  isLinkedInSponsoredText,
  scrapeLinkedInOpenThread,
} from '../../entrypoints/lib/linkedinThread';

const LINKEDIN_MESSAGING_HTML = `
  <div class="scaffold-layout__inner">
    <aside class="msg-conversations-container">
      <h1>Messaging</h1>
      <ul class="msg-conversations-container__conversations-list">
        <li class="msg-conversation-listitem">
          <div class="msg-entity-lockup__entity-title">Peter Lezama</div>
          <div class="msg-s-message">Sponsored Messaging Ad You're receiving this ad because your profile or activity matches the intended audience. This p</div>
        </li>
        <li class="msg-conversation-listitem msg-conversation-listitem--active">
          <div class="msg-entity-lockup__entity-title">Glen Trafford</div>
          <div class="msg-s-message">You: Sent ya an email</div>
        </li>
      </ul>
    </aside>
    <section class="scaffold-layout__detail">
      <div class="msg-thread">
        <div class="msg-title-bar">
          <a class="msg-thread__link-to-profile">
            <span class="msg-entity-lockup__entity-title">Glen Trafford</span>
            <span class="msg-entity-lockup__entity-info">General Manager - Salmon Arm Toyota</span>
          </a>
        </div>
        <div class="msg-s-message-list-content">
          <div class="msg-s-event-listitem msg-s-event-listitem--other">gtrafford@salmonarmtoyota.com</div>
          <div class="msg-s-event-listitem msg-s-event-listitem--self">Sent ya an email</div>
        </div>
      </div>
    </section>
  </div>
`;

describe('LinkedIn open-thread scrape', () => {
  it('ignores the sponsored inbox row and reads the open conversation', () => {
    document.body.innerHTML = LINKEDIN_MESSAGING_HTML;
    window.history.pushState({}, '', '/messaging/thread/2-glen/');
    Object.defineProperty(window, 'location', {
      value: { href: 'https://www.linkedin.com/messaging/thread/2-glen/', pathname: '/messaging/thread/2-glen/' },
      writable: true,
    });

    expect(isLinkedInSponsoredText("Sponsored Messaging Ad You're receiving this ad")).toBe(true);
    expect(extractLinkedInThreadCustomer(document).name).toBe('Glen Trafford');
    const scraped = scrapeLinkedInOpenThread(document);
    expect(scraped.header_text).toContain('Glen Trafford');
    expect(scraped.last_inbound_text).toContain('gtrafford@salmonarmtoyota.com');
    expect(scraped.raw_text).not.toMatch(/Sponsored Messaging Ad/i);
    expect(scraped.raw_text).not.toContain('Peter Lezama');
  });

  it('still reads the open overlay thread when LinkedIn wraps it in the bubble shell', () => {
    document.body.innerHTML = `
      <div class="msg-overlay-list-bubble">
        <div class="msg-overlay-list-bubble__content">
          <ul class="msg-conversations-container__conversations-list">
            <li><div class="msg-entity-lockup__entity-title">Peter Lezama</div></li>
          </ul>
          <div class="msg-overlay-conversation-bubble msg-overlay-conversation-bubble--default-active">
            <div class="msg-overlay-bubble-header">
              <div class="msg-overlay-bubble-header__title">Chris Hogan</div>
            </div>
            <div class="msg-s-message-list-content">
              <div class="msg-s-event-listitem msg-s-event-listitem--other">Thanks for connecting but I'm not interested.</div>
            </div>
          </div>
        </div>
      </div>
    `;
    Object.defineProperty(window, 'location', {
      value: { href: 'https://www.linkedin.com/messaging/', pathname: '/messaging/' },
      writable: true,
    });
    expect(extractLinkedInThreadCustomer(document).name).toBe('Chris Hogan');
    expect(scrapeLinkedInOpenThread(document).last_inbound_text).toMatch(/not interested/i);
  });
});
