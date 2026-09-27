import { beforeEach, describe, expect, it } from 'vitest';
import { instagramAdapter } from '../../entrypoints/lib/platforms/instagram';
import { platformIdFromUrl } from '../../entrypoints/lib/platforms/registry';

// Live DOM captured 2026-09-26 from
// https://www.instagram.com/cardogvlogs/?hl=en. The profile adapter itself
// could read this shape, but content.ts and the side panel independently
// classified the URL as "unknown", preventing both chip and scan messages.
describe('Instagram profile live DOM routing', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (window as any).happyDOM.setURL('https://www.instagram.com/cardogvlogs/?hl=en');
  });

  it('routes the exact live profile URL to Instagram', () => {
    expect(platformIdFromUrl(window.location.href)).toBe('instagram');
    expect(instagramAdapter.detect()).toBe(true);
  });

  it('extracts the profile username and readable header from the live DOM shape', () => {
    document.body.innerHTML = `
      <main role="main">
        <header>
          <h1>cardogvlogs</h1>
          <div>Yancy Garcia him</div>
          <div>213 posts</div>
          <div>263 followers</div>
          <div>257 following</div>
          <div>Digital creator</div>
          <div>Main @yancygarcia_3</div>
          <div>Sold $26.8M in cars. Now running @brevmontlabs</div>
          <div>Close more leads. Get more reviews. Show your work...</div>
          <div>brevmont.com/sales-reps</div>
          <div>Followed by _luisolivares</div>
        </header>
      </main>`;

    const customer = instagramAdapter.extractCustomer();
    const thread = instagramAdapter.scrapeThread();

    expect(customer).toMatchObject({
      name: 'Yancy Garcia',
      username: 'cardogvlogs',
      profile_url: 'https://www.instagram.com/cardogvlogs/',
      raw_source: 'ig_profile_display_name',
    });
    expect(thread.header_text).toBe('@cardogvlogs — Yancy Garcia');
    expect(thread.raw_text).toContain('Sold $26.8M in cars');
    expect(thread.profile_bio).toContain('Digital creator');
    expect(thread.profile_bio).toContain('Close more leads. Get more reviews. Show your work...');
    expect(thread.profile_bio).not.toContain('213 posts');
    expect(thread.profile_bio).not.toContain('Followed by');
    expect(thread.last_inbound_text).toBe('');
  });
});
