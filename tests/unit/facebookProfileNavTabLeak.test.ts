import { beforeEach, describe, expect, it } from 'vitest';
import { extractFacebookProfileSnapshot, facebookAdapter } from '../../entrypoints/lib/platforms/facebook';

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

  it('finds the profile name when Facebook omits h1/h2 and ignores About section chrome', () => {
    document.body.innerHTML = `
      <div role="main">
        <div>Johnny Flores</div>
        <div>296 friends</div>
        <div>Ventura, CA</div>
        <div>Inside Car Guys</div>
        <div role="tablist"><div>All</div><div>About</div><div>Friends</div><div>Photos</div><div>Reels</div><div>More</div></div>
        <h2>Personal details</h2>
        <div>Lives in Ventura, California</div>
        <div>From Ventura, California</div>
      </div>`;
    const customer = facebookAdapter.extractCustomer();
    const thread = facebookAdapter.scrapeThread();
    expect(customer).toMatchObject({
      name: 'Johnny Flores',
      username: 'jflores.carguy',
      profile_url: 'https://www.facebook.com/jflores.carguy',
    });
    expect(thread.header_text).toBe('Johnny Flores');
    expect(thread.profile_bio).toContain('Lives in Ventura, California');
    expect(thread.profile_bio).not.toContain('Personal details');
    expect(thread.raw_text).not.toContain('All About Friends Photos Reels More');
    expect(thread.last_inbound_text).toBe('');
  });

  it('rejects Links and reads a professional-profile name from large identity text', () => {
    window.history.pushState({}, '', '/hridoyreh/');
    document.body.innerHTML = `
      <div role="main">
        <div dir="auto" style="font-size: 32px">Hridoy Reh</div>
        <div role="tablist"><div role="tab">All</div><div role="tab">About</div></div>
        <h2>Links</h2>
        <a href="https://hridoyreh.com">hridoyreh.com</a>
      </div>`;
    const snapshot = extractFacebookProfileSnapshot();
    expect(snapshot).toMatchObject({
      status: 'ready',
      display_name: 'Hridoy Reh',
      username: 'hridoyreh',
    });
    expect(facebookAdapter.extractCustomer().name).toBe('Hridoy Reh');
  });

  it('prefers profile-image identity over unrelated callout text', () => {
    window.history.pushState({}, '', '/andres.mercadomejia.5/');
    document.body.innerHTML = `
      <div role="main">
        <img alt="Wilder Merck's profile picture" />
        <strong>Here's how:</strong>
        <h2>Personal details</h2>
      </div>`;
    const snapshot = extractFacebookProfileSnapshot();
    expect(snapshot.display_name).toBe('Wilder Merck');
    expect(snapshot.evidence.some((item) => item.source === 'profile_image')).toBe(true);
  });

  it('supports a group-member profile without treating the group feed as the prospect', () => {
    window.history.pushState({}, '', '/groups/467706240992641/user/612948509/');
    document.body.innerHTML = `
      <div role="main">
        <h1>Paul Desrosier</h1>
        <div>1095 friends</div>
        <div role="tablist"><div role="tab">Group posts</div><div role="tab">Paul's contributions</div></div>
      </div>`;
    expect(facebookAdapter.extractCustomer()).toMatchObject({
      name: 'Paul Desrosier',
      profile_url: 'https://www.facebook.com/profile.php?id=612948509',
    });
  });

  it('fails closed on the Facebook home feed even when notification chrome looks like a name', () => {
    window.history.pushState({}, '', '/');
    document.body.innerHTML = `
      <div role="main"><h2>Notification Actions</h2><article><h2>Camden Gladden</h2></article></div>`;
    expect(facebookAdapter.detect()).toBe(false);
    expect(facebookAdapter.extractCustomer().name).toBeFalsy();
    expect(extractFacebookProfileSnapshot().status).toBe('unsupported');
  });

  it.each([
    ['/ahormozi/', 'Alex Hormozi'],
    ['/josiahgomulaofficial/', 'Josiah Gomula'],
  ])('reads %s without allowing the Links section to win', (path, name) => {
    window.history.pushState({}, '', path);
    document.body.innerHTML = `
      <main>
        <h1>${name}</h1>
        <div role="tablist"><div role="tab">All</div><div role="tab">About</div></div>
        <h2>Links</h2>
      </main>`;
    expect(facebookAdapter.extractCustomer().name).toBe(name);
  });
});
