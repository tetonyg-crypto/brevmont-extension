import { beforeEach, describe, expect, it } from 'vitest';
import { facebookAdapter } from '../../entrypoints/lib/platforms/facebook';

// 2026-09-26 regression: on a real Facebook profile page, the name heading
// reader fell through to the nav tab bar (All / About / Friends / Photos /
// Reels / More) sitting just below the name -- confirmed live: "This for
// Reels?" reached the chip on Johnny Flores's profile instead of his name.
// Root cause: readHeaderText()'s selector chain wasn't scoped to exclude
// the tablist, and "Reels" wasn't in the UI-name reject list either.
describe('Facebook profile page: nav tab bar must never be read as the customer name', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.pushState({}, '', '/jflores.carguy/');
  });

  it('skips a tab-bar element even when it matches the header selector chain ahead of the real name', () => {
    document.body.innerHTML = `
      <div role="main">
        <h1 role="tab" style="display:inline">Reels</h1>
        <h1>Johnny Flores</h1>
      </div>`;
    const customer = facebookAdapter.extractCustomer();
    expect(customer.name).toBe('Johnny Flores');
  });

  it('falls back to empty rather than a nav tab label when no real name element exists', () => {
    document.body.innerHTML = `
      <div role="main">
        <div role="tablist"><h2>Reels</h2></div>
      </div>`;
    const customer = facebookAdapter.extractCustomer();
    expect(customer.name).toBeFalsy();
  });
});
