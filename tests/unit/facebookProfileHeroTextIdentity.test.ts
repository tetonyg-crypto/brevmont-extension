import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractFacebookProfileSnapshot, facebookAdapter } from '../../entrypoints/lib/platforms/facebook';

// 2026-09-27 regression: Facebook profile scans were inconsistent -- reading
// some profiles correctly and failing (or returning the wrong name) on
// others, with no reproducible selector-level difference between them.
//
// Root cause, proven with live evidence from two independent real Facebook
// profiles (facebook.com/ahormozi, facebook.com/zuck) fetched while signed
// out: in this (common) Facebook render state, the actual profile-hero name
// is a LEAF <span> with font-size:32px, font-weight:700, and NO dir="auto"
// attribute at all. The four strong identity signals -- meta og:title,
// document.title, h1/h2 headings, and the old dir="auto" large-text check --
// were all simultaneously unavailable on both profiles (og:title absent, no
// h1 present, document.title reduced to the bare word "Facebook", and the
// name span carries no dir attribute). Extraction therefore fell through
// EVERY time in this render state to a single last-resort heuristic (the
// first plausible line of main.innerText before the nav tab bar), which
// only barely clears the minimum acceptance score and has no protection
// against a sidebar/suggested-profile name rendering earlier in reading
// order during a slower hydration. That single point of failure is what
// produced "works on some pages, fails (or reads the wrong name) on
// others" -- not a per-page selector gap.
describe('Facebook profile hero name: large+bold leaf text without dir="auto"', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reads the real profile name from a large/bold leaf span with no dir attribute, no og:title, no h1, and a generic document.title (the exact live-observed failure shape)', () => {
    window.history.pushState({}, '', '/ahormozi');
    document.title = 'Facebook';
    document.body.innerHTML = `
      <div role="main">
        <span style="font-size:32px; font-weight:700">Alex Hormozi</span>
        <span style="font-size:17px; font-weight:500">998K followers</span>
        <div role="tablist"><div role="tab">All</div><div role="tab">About</div></div>
      </div>`;
    const snapshot = extractFacebookProfileSnapshot();
    expect(snapshot).toMatchObject({ status: 'ready', display_name: 'Alex Hormozi' });
    expect(snapshot.evidence.some((item) => item.source === 'identity_text' && item.weight === 4)).toBe(true);
    expect(facebookAdapter.extractCustomer().name).toBe('Alex Hormozi');
  });

  it('does not let a sidebar/suggested-profile name win over the real large+bold hero name', () => {
    window.history.pushState({}, '', '/zuck');
    document.title = 'Facebook';
    document.body.innerHTML = `
      <div role="main">
        <aside><div>Suggested for you</div><span>Jordan Suggested</span></aside>
        <span style="font-size:32px; font-weight:700">Mark Zuckerberg</span>
        <div role="tablist"><div role="tab">All</div><div role="tab">About</div></div>
      </div>`;
    expect(facebookAdapter.extractCustomer().name).toBe('Mark Zuckerberg');
  });

  it('still rejects a large/bold leaf that is UI chrome, not an identity', () => {
    window.history.pushState({}, '', '/somehandle');
    document.title = 'Facebook';
    document.body.innerHTML = `
      <div role="main">
        <span style="font-size:32px; font-weight:700">Notifications</span>
      </div>`;
    expect(extractFacebookProfileSnapshot().status).toBe('uncertain');
    expect(facebookAdapter.extractCustomer().name).toBeFalsy();
  });

  it('does not regress the pre-existing dir="auto" text signal at a lower weight when it is not bold/32px', () => {
    window.history.pushState({}, '', '/someoneelse');
    document.body.innerHTML = `
      <div role="main">
        <div dir="auto" style="font-size: 24px; font-weight: 400">Someone Else</div>
      </div>`;
    const snapshot = extractFacebookProfileSnapshot();
    expect(snapshot.display_name).toBe('Someone Else');
    expect(snapshot.evidence.some((item) => item.source === 'identity_text' && item.weight === 2)).toBe(true);
  });
});

describe('Facebook SPA navigation: stale identity must not survive a route change', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('extractFacebookProfileSnapshot re-reads fresh per call and reflects a URL change immediately (no cached identity carried across navigation)', () => {
    window.history.pushState({}, '', '/firstprofile');
    document.body.innerHTML = `<div role="main"><span style="font-size:32px; font-weight:700">First Person</span></div>`;
    expect(extractFacebookProfileSnapshot().display_name).toBe('First Person');

    window.history.pushState({}, '', '/secondprofile');
    document.body.innerHTML = `<div role="main"><span style="font-size:32px; font-weight:700">Second Person</span></div>`;
    const second = extractFacebookProfileSnapshot();
    expect(second.display_name).toBe('Second Person');
    expect(second.route_key).toBe('fb_profile:secondprofile');
  });
});
