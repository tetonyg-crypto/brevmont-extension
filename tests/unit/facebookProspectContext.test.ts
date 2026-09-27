import { beforeEach, describe, expect, it } from 'vitest';
import {
  extractFacebookProfileSnapshot,
  facebookAdapter,
  guardFacebookProfileCarryover,
  resetFacebookProfileCarryoverForTests,
} from '../../entrypoints/lib/platforms/facebook';
import { sanitizeFacebookProspectContext } from '../../entrypoints/lib/platforms/facebookProspectContext';

// 2026-09-27: Facebook Prospect Context was a page dump. The old scraper kept
// every line of [role="main"] that wasn't on a small blocklist, so the post
// composer, Stories, the feed, "People you may know", ads and the footer all
// landed in the lead card. These fixtures mirror the live failures.

const lines = (...values: string[]) => values.map((v) => `<div>${v}</div>`).join('');
const tabs = (...values: string[]) => `<div role="tablist">${values.map((v) => `<div role="tab">${v}</div>`).join('')}</div>`;

const PAGE_DUMP = [
  "What's on your mind?", 'Create a post', 'Stories', 'Feed', 'FacebookFacebookFacebook', 'MessengerSend',
  'Send message', 'People you may know', 'Suggested for you', 'Sponsored',
  'Privacy · Terms · Advertising · Ad Choices · Cookies · More · Meta © 2026',
];

function expectNoDump(context: string) {
  for (const chrome of PAGE_DUMP) expect(context).not.toContain(chrome);
  expect(context).not.toMatch(/followers|following|Call now|^Details$|^Links$|Like|Comment|Share/m);
  expect(context.split('\n').length).toBeLessThanOrEqual(5);
  expect(context.length).toBeLessThanOrEqual(500);
}

function scan(path: string, html: string, title = 'Facebook') {
  window.history.pushState({}, '', path);
  document.title = title;
  document.body.innerHTML = `<div role="main">${html}</div>`;
  const snapshot = extractFacebookProfileSnapshot();
  return { snapshot, context: snapshot.profile_bio || '' };
}

describe('Facebook Prospect Context: short prospect summary, never a page dump', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetFacebookProfileCarryoverForTests();
  });

  it('A: business page keeps the description + category and drops counts, CTAs, Details/Links, posts and footer', () => {
    const { snapshot, context } = scan('/wscautocenter', `
      <h1>WSC AUTO Center</h1>
      ${lines('2.1K followers', '48 following', 'Call now', 'Message', 'Like')}
      ${tabs('Posts', 'About', 'Mentions', 'Reviews', 'Followers', 'Photos', 'More')}
      ${lines('Intro',
        'German automotive repair and service for BMW, Audi, Mercedes-Benz, VW and Porsche.',
        'Page · Automotive Repair Shop',
        '1234 Fairview Ave, Boise, ID 83702',
        '(208) 555-0199', 'service@wscauto.com', 'wscauto.com',
        'Not yet rated (0 Reviews)', 'Always open')}
      ${lines('Details', 'Links', 'Photos', 'See all photos')}
      ${lines('Create a post', "What's on your mind?", 'WSC AUTO Center', '3d',
        'Just finished a full timing chain job on this 2014 BMW 535i. Book your service today and ask about our winter special.',
        'Like', 'Comment', 'Share', 'Sponsored', 'Privacy · Terms · Advertising · Ad Choices · Cookies · More · Meta © 2026')}
    `);
    expect(snapshot.display_name).toBe('WSC AUTO Center');
    expect(context).toContain('German automotive repair and service');
    expect(context).toContain('Automotive Repair Shop');
    expect(context).not.toContain('timing chain');
    expect(context).not.toMatch(/555-0199|wscauto\.com|Fairview|Not yet rated|Always open/);
    expectNoDump(context);
  });

  it('B: creator keeps the specialty + category and drops the composer, suggestions and feed posts', () => {
    const { snapshot, context } = scan('/hridoyreh', `
      <h1>Hridoy Reh</h1>
      ${lines('12K followers • 150 following', 'Add friend', 'Message')}
      ${tabs('All', 'About', 'Followers', 'Photos', 'Reels', 'More')}
      ${lines('Intro', 'SEO / marketing specialist helping local businesses rank on Google',
        'Profile · Advertising/Marketing', 'Lives in Dhaka, Bangladesh', 'Joined March 2016')}
      ${lines('Photos', 'Stories', 'Create story', "What's on your mind?", 'Live video', 'Photo/video', 'Posts', 'Filters',
        'Hridoy Reh', '5h', 'Top 10 SEO tips for 2026 that every agency owner should know about before the next update.',
        'People you may know', 'Jessica Tran', 'Add friend', 'Marco Diaz', 'Add friend')}
    `);
    expect(snapshot.display_name).toBe('Hridoy Reh');
    expect(context).toContain('SEO / marketing specialist');
    expect(context).toContain('Advertising/Marketing');
    expect(context).not.toMatch(/Top 10 SEO tips|Jessica Tran|Marco Diaz|Joined/);
    expectNoDump(context);
  });

  it('C: group-profile person keeps a clean intro when one exists', () => {
    const { snapshot, context } = scan('/groups/idahoconstruction/user/100001/', `
      <h1>Mark Fulton</h1>
      ${lines('Member of Idaho Construction', 'Joined Facebook in 2014', 'View profile', 'Message')}
      ${lines('Intro', 'Project manager at Fulton Builders')}
      ${lines("Mark's posts in this group", 'Mark Fulton', '2d', 'Anyone have a good excavator for rent near Nampa this week?', 'Like', 'Comment')}
    `);
    expect(snapshot.display_name).toBe('Mark Fulton');
    expect(context).toBe('Project manager at Fulton Builders');
  });

  it('C: group-profile person with no intro gets empty context, not group chrome or posts', () => {
    const { snapshot, context } = scan('/groups/idahoconstruction/user/100001/', `
      <h1>Mark Fulton</h1>
      ${lines('Member of Idaho Construction', 'Joined Facebook in 2014', 'View profile', 'Message',
        "Mark's posts in this group", 'Mark Fulton', '2d', 'Anyone have a good excavator for rent near Nampa this week?', 'Like', 'Comment')}
    `);
    expect(snapshot.display_name).toBe('Mark Fulton');
    expect(context).toBe('');
  });

  it('F: a profile with only Facebook chrome and feed returns empty context', () => {
    const { snapshot, context } = scan('/ronan.danial', `
      <h1>Ronan Danial</h1>
      ${lines('1.1K friends', 'Add friend', 'Message')}
      ${tabs('All', 'About', 'Friends', 'Photos', 'Reels', 'More')}
      ${lines(...PAGE_DUMP, 'Ronan Danial', '1w', 'Great weekend at the lake with everyone!', 'Like', 'Comment', 'Share', 'Jordan Smith', 'Add friend')}
    `);
    expect(snapshot.display_name).toBe('Ronan Danial');
    expect(context).toBe('');
    expect(facebookAdapter.scrapeThread().raw_text).toBe('Profile: Ronan Danial');
  });

  it('a stored page dump from an older build is never displayed', () => {
    const dump = ['About: Intro', ...PAGE_DUMP, 'Camden Gladden', 'Jessica Tran', 'Great weekend at the lake'].join('\n');
    expect(sanitizeFacebookProspectContext(dump, 'Camden Gladden')).toBe('');
    expect(sanitizeFacebookProspectContext('Owner at Gladden Detailing\nAutomotive Service', 'Camden Gladden'))
      .toBe('Owner at Gladden Detailing\nAutomotive Service');
  });
});

describe('Facebook names never absorb neighbouring text', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetFacebookProfileCarryoverForTests();
  });

  it('E: Samantha Daryn Rivera is not "Idaho Construction Samantha Daryn Rivera" (numeric group id)', () => {
    const { snapshot } = scan('/groups/884422113/user/100002/', `
      <a href="/groups/884422113/user/100002/"><span>Idaho Construction</span> <span>Samantha Daryn Rivera</span></a>
      <a href="/groups/884422113/user/100002/"><span>Idaho Construction</span> <span>Samantha Daryn Rivera</span></a>
      <h1>Samantha Daryn Rivera</h1>
      ${lines('Member of Idaho Construction')}
    `);
    expect(snapshot.display_name).toBe('Samantha Daryn Rivera');
  });

  it('E: a group label glued to the name is stripped using the group slug', () => {
    const { snapshot } = scan('/groups/idahoconstruction/user/100002/', `
      <h1>Idaho Construction Samantha Daryn Rivera</h1>
    `);
    expect(snapshot.display_name).toBe('Samantha Daryn Rivera');
  });

  it.each([
    ['/mark.fulton', 'Mark Fulton'],
    ['/piotr.proditus', 'Piotr Proditus'],
    ['/ronan.danial', 'Ronan Danial'],
    ['/camden.gladden', 'Camden Gladden'],
    ['/hridoyreh', 'Hridoy Reh'],
  ])('person %s resolves exactly to %s', (path, name) => {
    const { snapshot } = scan(path, `<h1>${name}</h1>${lines('Add friend', 'Message')}`);
    expect(snapshot.display_name).toBe(name);
  });

  it.each([
    ['/wscautocenter', 'WSC AUTO Center'],
    ['/apexsmartpergola', 'Apex Smart Pergola'],
    ['/rdzpavement', 'Rdz Pavement Maintenance'],
  ])('business page %s keeps its full name %s', (path, name) => {
    const { snapshot } = scan(path, `
      <img alt="${name}'s profile picture" />
      <h1>${name}</h1>
      <h2>${name.split(' ').slice(1).join(' ')}</h2>
    `);
    expect(snapshot.display_name).toBe(name);
  });
});

describe('D: Facebook SPA route change never carries the previous profile over', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetFacebookProfileCarryoverForTests();
  });

  const markDom = `<h1>Mark Fulton</h1>${tabs('All', 'About')}${lines('Intro', 'Owner of Fulton Custom Homes, building across the Treasure Valley since 2009')}`;
  const piotrDom = `<h1>Piotr Proditus</h1>${tabs('All', 'About')}${lines('Intro', 'Fleet manager at Proditus Logistics')}`;

  it('URL already on Piotr but DOM still Mark: the read is uncertain, then Piotr commits with Piotr context only', () => {
    window.history.pushState({}, '', '/mark.fulton');
    document.body.innerHTML = `<div role="main">${markDom}</div>`;
    expect(facebookAdapter.extractCustomer().name).toBe('Mark Fulton');
    expect(facebookAdapter.scrapeThread().profile_bio).toContain('Fulton Custom Homes');

    window.history.pushState({}, '', '/piotr.proditus');
    expect(facebookAdapter.extractCustomer().name).toBeNull();
    expect(facebookAdapter.scrapeThread().profile_bio ?? null).toBeNull();

    document.body.innerHTML = `<div role="main">${piotrDom}</div>`;
    expect(facebookAdapter.extractCustomer().name).toBe('Piotr Proditus');
    const thread = facebookAdapter.scrapeThread();
    expect(thread.profile_bio).toBe('Fleet manager at Proditus Logistics');
    expect(thread.raw_text).not.toContain('Mark');
  });

  it('Piotr name rendered but Mark\'s Intro not swapped yet: Mark\'s context is dropped', () => {
    window.history.pushState({}, '', '/mark.fulton');
    document.body.innerHTML = `<div role="main">${markDom}</div>`;
    facebookAdapter.scrapeThread();

    window.history.pushState({}, '', '/piotr.proditus');
    document.body.innerHTML = `<div role="main"><h1>Piotr Proditus</h1>${tabs('All', 'About')}${lines('Intro', 'Owner of Fulton Custom Homes, building across the Treasure Valley since 2009')}</div>`;
    const thread = facebookAdapter.scrapeThread();
    expect(thread.header_text).toBe('Piotr Proditus');
    expect(thread.profile_bio ?? null).toBeNull();
  });

  it('the same person reached by a second URL form is accepted once the swap window passes', () => {
    const snap = (route: string, name: string) => ({
      surface: 'profile_direct' as const, status: 'ready' as const, display_name: name, username: null, facebook_id: null,
      profile_url: null, profile_bio: 'Fleet manager', confidence: 0.9, evidence: [], route_key: route,
    });
    expect(guardFacebookProfileCarryover(snap('fb_profile:piotr', 'Piotr Proditus'), 1000).status).toBe('ready');
    expect(guardFacebookProfileCarryover(snap('fb_profile:id:42', 'Piotr Proditus'), 1100).status).toBe('uncertain');
    const later = guardFacebookProfileCarryover(snap('fb_profile:id:42', 'Piotr Proditus'), 4000);
    expect(later.status).toBe('ready');
    expect(later.profile_bio).toBe('Fleet manager');
  });
});
