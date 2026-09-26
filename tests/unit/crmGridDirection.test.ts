import { beforeEach, describe, expect, test } from 'vitest';
import { dealersocketAdapter } from '../../entrypoints/lib/platforms/dealersocket';
import { eleadAdapter } from '../../entrypoints/lib/platforms/elead';

// 2026-09-26 audit: every DealerSocket / Elead grid row was 'unknown' and
// last_inbound_text was simply the last row -- the rep's own reply, or the
// OLDEST message when the grid is newest-first.

describe('DealerSocket message rows', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('rep reply as last row is not the last inbound', () => {
    document.body.innerHTML = `<div class="messageList">
      <div class="messageRow inbound">Is the Silverado still available?</div>
      <div class="messageRow outbound">Yes, come by at 3!</div>
    </div>`;
    const thread = dealersocketAdapter.scrapeThread();
    expect(thread.messages.map((m) => m.direction)).toEqual(['inbound', 'outbound']);
    expect(thread.last_inbound_text).toBe('Is the Silverado still available?');
  });

  test('rows without a determinable direction never become last inbound', () => {
    document.body.innerHTML = `<div class="messageList">
      <div class="messageRow">Hello there</div>
      <div class="messageRow">Thanks, see you soon</div>
    </div>`;
    const thread = dealersocketAdapter.scrapeThread();
    expect(thread.last_inbound_text).toBe('');
  });
});

describe('Elead message grid', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('newest-first grid: last inbound is the newest inbound by timestamp, not the bottom row', () => {
    document.body.innerHTML = `<table id="ctl00_MainContent_gvMessages">
      <tr><th>Date</th><th>Dir</th><th>Message</th></tr>
      <tr><td>09/25/2026 4:10 PM</td><td>Outbound</td><td>Sure, 5pm works.</td></tr>
      <tr><td>09/25/2026 3:55 PM</td><td>Inbound</td><td>Can I come at 5 instead?</td></tr>
      <tr><td>09/24/2026 9:00 AM</td><td>Inbound</td><td>Interested in the Tahoe.</td></tr>
    </table>`;
    const thread = eleadAdapter.scrapeThread();
    expect(thread.last_inbound_text).toContain('Can I come at 5 instead?');
  });

  test('no direction cell: nothing is guessed', () => {
    document.body.innerHTML = `<table id="ctl00_MainContent_gvMessages">
      <tr><td>Sure, 5pm works.</td></tr>
      <tr><td>Interested in the Tahoe.</td></tr>
    </table>`;
    expect(eleadAdapter.scrapeThread().last_inbound_text).toBe('');
  });
});
