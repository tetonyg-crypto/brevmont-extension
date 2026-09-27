import { beforeEach, describe, expect, it } from 'vitest';
import {
  extractFacebookProfileSnapshot,
  facebookAdapter,
  guardFacebookProfileCarryover,
  resetFacebookProfileCarryoverForTests,
} from '../../entrypoints/lib/platforms/facebook';
import { sanitizeFacebookProspectContext } from '../../entrypoints/lib/platforms/facebookProspectContext';

// 2026-09-27: Facebook Prospect Context was first a page dump (composer,
// Stories, feed, "People you may know", ads, footer), then — after the
// allow-list fix — too conservative for the live 2026 layout, where the bio,
// category, location and workplace sit in the profile header and contact
// data sits under Details / Contact info / Links. Fixtures marked LIVE are the
// exact [role="main"].innerText line order captured from real profiles.

const lines = (...values: string[]) => values.map((v) => `<div>${v}</div>`).join('');
const tabs = (...values: string[]) => `<div role="tablist">${values.map((v) => `<div role="tab">${v}</div>`).join('')}</div>`;

const PAGE_DUMP = [
  "What's on your mind?", 'Create a post', 'Stories', 'Feed', 'FacebookFacebookFacebook', 'MessengerSend',
  'Send message', 'People you may know', 'Suggested for you', 'Sponsored',
  'Privacy · Terms · Advertising · Ad Choices · Cookies · More · Meta © 2026',
];

const FEED_TAIL = [
  'Posts', 'Filters', 'Facebook', 'Facebook', 'Facebook', 'Create a post', "What's on your mind?",
  '5h', 'If AI kills junior marketing work, how do we get senior marketers?', 'Like', 'Comment', 'Share',
  'People you may know', 'Jessica Tran', 'Add friend', 'Sponsored', 'Privacy · Terms · Advertising · Ad Choices · Cookies · More · Meta © 2026',
];

function expectNoDump(context: string) {
  for (const chrome of PAGE_DUMP) expect(context).not.toContain(chrome);
  expect(context).not.toMatch(/\bfollowers\b|\bfollowing\b|Call now|Not yet rated|Closed now|Always open|Jessica Tran|junior marketing|\bLike\b|\bComment\b/);
  expect(context.split('\n').length).toBe(1);
  expect(context.length).toBeLessThanOrEqual(700);
}

function scan(path: string, html: string, title = 'Facebook') {
  window.history.pushState({}, '', path);
  document.title = title;
  document.body.innerHTML = `<div role="main">${html}</div>`;
  const snapshot = extractFacebookProfileSnapshot();
  return { snapshot, context: snapshot.profile_bio || '' };
}

describe('Facebook Prospect Context: structured public profile fields, never a page dump', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetFacebookProfileCarryoverForTests();
  });

  it('Peyton Moda: captures the intro with the public work phone, moderator role and creator category', () => {
    const { snapshot, context } = scan('/peyton.moda', `
      <h1>Peyton Moda</h1>
      ${lines('3.4K followers • 210 following', 'Follow', 'Message', 'Search')}
      ${tabs('All', 'About', 'Reels', 'Photos', 'Followers', 'More')}
      ${lines('Intro',
        'Facebook doesn’t always let people message me. Got Moda questions? Text my work phone: 605-906-0529',
        'Moderator of Moda Collective', 'Profile · Digital creator', 'Photos', 'See all photos', ...FEED_TAIL)}
    `);
    expect(snapshot.display_name).toBe('Peyton Moda');
    expect(context).toContain('605-906-0529');
    expect(context).toContain('Moderator of Moda Collective');
    expect(context).toContain('Digital creator');
    expectNoDump(context);
  });

  it('Bitkey: captures the business description, category, website and public social handles', () => {
    const { snapshot, context } = scan('/bitkeyworld', `
      <h1>Bitkey</h1>
      ${lines('25K followers • 3 following', 'Message', 'Follow', 'Search',
        'Bitkey is the self-custody bitcoin wallet with an app, hardware, and recovery tools. Built by the team at Block, Inc.',
        'Business Center', 'More')}
      ${tabs('All', 'About', 'Reels', 'Photos', 'Followers', 'More')}
      ${lines('Links', 'bitkey.world', 'ownbitkey', 'bitkeyofficial',
        'Featured', 'Bitkey', 'Big news: inheritance is now live in the Bitkey app. Update today and set it up in minutes.', ...FEED_TAIL)}
    `);
    expect(snapshot.display_name).toBe('Bitkey');
    expect(context).toContain('self-custody bitcoin wallet with an app, hardware, and recovery tools');
    expect(context).toContain('Built by the team at Block, Inc.');
    expect(context).toContain('Website: bitkey.world');
    expect(context).toContain('@ownbitkey');
    expect(context).toContain('@bitkeyofficial');
    expect(context).not.toContain('inheritance');
    expectNoDump(context);
  });

  it('Hridoy Reh (LIVE line order): captures the SEO/marketing specialty, category and website', () => {
    const { snapshot, context } = scan('/hridoyreh', `
      <h1>Hridoy Reh</h1>
      ${lines('7K followers • 33 following', 'Follow', 'Search', 'An SEO / marketing specialist...', 'Advertising/Marketing', 'More',
        'All', 'About', 'Reels', 'Photos', 'Followers', 'More', 'Links', 'hridoyreh.com', 'Photos', 'See all photos',
        'Privacy', ' · Consumer Health Privacy', ' · Terms', ' · Advertising', ' · Ad Choices', ' · Cookies', ' · More', ...FEED_TAIL)}
    `);
    expect(snapshot.display_name).toBe('Hridoy Reh');
    expect(context).toBe('An SEO / marketing specialist. Advertising/Marketing. Website: hridoyreh.com.');
  });

  it('Grupo Fuerza Legal: captures the law-firm description, category, website and email', () => {
    const { snapshot, context } = scan('/grupofuerzalegal', `
      <h1>Grupo Fuerza Legal</h1>
      ${lines('12 followers • 0 following', 'Message', 'Follow', 'Search',
        'Los abogados de Grupo Fuerza Legal ponen a disposición de la Comunidad Latina en el Sur de Californ...',
        'Lawyer & Law Firm', 'More', 'All', 'About', 'Followers', 'Photos', 'Mentions', 'More',
        'Details', 'Not yet rated (0 reviews)', 'Links', 'grupofuerzalegal.com',
        'Contact info', 'grupofuerzalegal@gmail.com', 'Grupo Fuerza Legal', ...FEED_TAIL)}
    `);
    expect(snapshot.display_name).toBe('Grupo Fuerza Legal');
    expect(context).toContain('Los abogados de Grupo Fuerza Legal ponen a disposición de la Comunidad Latina');
    expect(context).toContain('Lawyer & Law Firm');
    expect(context).toContain('Website: grupofuerzalegal.com');
    expect(context).toContain('Email: grupofuerzalegal@gmail.com');
    expectNoDump(context);
  });

  it('Grupo Fuerza Legal (LIVE line order): a long header bio is no longer dropped', () => {
    const { context } = scan('/grupofuerzalegal', `
      <h1>Grupo Fuerza Legal</h1>
      ${lines('12 followers • 0 following', 'Message', 'Follow', 'Search',
        'Grupo Fuerza Legal es la organización de representación legal más confiable para casos de accidentes y de casos laborales en California.',
        'Consulting agency', 'More', 'All', 'About', 'Followers', 'Photos', 'Mentions', 'More',
        'Details', 'Not yet rated (0 reviews)', 'Links', 'grupofuerzalegal.com', ...FEED_TAIL)}
    `);
    expect(context).toContain('representación legal más confiable');
    expect(context).toContain('Consulting agency');
    expect(context).toContain('Website: grupofuerzalegal.com');
    expectNoDump(context);
  });

  it('Alex Ramirez: captures an Intro membership/work field, nothing from cover art or group feed', () => {
    const { snapshot, context } = scan('/alex.ramirez.siding', `
      <img alt="Cover photo: Solid Seal Siding" />
      <h1>Alex Ramirez</h1>
      ${lines('412 friends', 'Add friend', 'Message')}
      ${tabs('All', 'About', 'Friends', 'Photos', 'Reels', 'More')}
      ${lines('Intro', 'Member of Siding Installer', 'Photos', 'Siding Installer', 'Alex Ramirez', '2d',
        'Anyone need a crew in Boise next week? DM me.', 'Like', 'Comment', ...FEED_TAIL)}
    `);
    expect(snapshot.display_name).toBe('Alex Ramirez');
    expect(context).toBe('Member of Siding Installer.');
    expect(context).not.toContain('Solid Seal');
  });

  it('Paulina Salazar: captures the intro with both Instagram handles and the creator category', () => {
    const { snapshot, context } = scan('/paulina.salazar.ut', `
      <h1>Paulina Salazar</h1>
      ${lines('1.9K followers', 'Follow', 'Message')}
      ${tabs('All', 'About', 'Reels', 'Photos', 'More')}
      ${lines('Intro', 'IG @thelasheffect.ut & @axiseventsut Helping women elevate their beauty, mind and business',
        'Profile · Digital creator', 'Photos', ...FEED_TAIL)}
    `);
    expect(snapshot.display_name).toBe('Paulina Salazar');
    expect(context).toContain('@thelasheffect.ut');
    expect(context).toContain('@axiseventsut');
    expect(context).toContain('Helping women elevate their beauty, mind and business');
    expect(context).toContain('Digital creator');
    expectNoDump(context);
  });

  it('Ronan Danial: no meaningful public bio stays empty (card shows the minimal line)', () => {
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

  it('public figure (LIVE line order): header bio/category/location/workplace + Personal details; birthday and Communities excluded', () => {
    const { context } = scan('/zuck', `
      <h1>Mark Zuckerberg</h1>
      ${lines('121M followers', 'Follow', 'Search', 'Bringing the world closer together.', 'Public figure', 'Palo Alto, CA',
        'Meta', 'Harvard University', 'More', 'All', 'About', 'Reels', 'Photos', 'Friends', 'More',
        'Personal details', 'Lives in Palo Alto, California', 'From Dobbs Ferry, New York', 'May 14, 1984', 'See more personal details',
        'Communities', 'Meta Channel', 'Channel · 823K members', ...FEED_TAIL)}
    `);
    expect(context).toContain('Bringing the world closer together.');
    expect(context).toContain('Public figure');
    expect(context).toContain('Palo Alto, CA');
    expect(context).toContain('Meta.');
    expect(context).toContain('Lives in Palo Alto, California');
    expect(context).not.toMatch(/May 14|See more|Meta Channel|823K/);
    expectNoDump(context);
  });

  it('local business (LIVE line order): category, phone and email captured once; rating, hours and street address dropped', () => {
    const { context } = scan('/fixitrightboise', `
      <h1>Fix It Right Auto Repair Boise</h1>
      ${lines('7 followers • 0 following', 'Call now', 'Message', 'Follow', 'Automotive Repair Shop', '(208) 260-1244', 'More',
        'All', 'About', 'Followers', 'Photos', 'Mentions', 'More',
        'Details', 'Not yet rated (0 reviews)', 'Closed now', '205 w Ellis st, Paul, ID, United States, 83347',
        'Contact info', '(208) 260-1244', 'fixitrightautorepairboise@gmail.com', 'Fix It Right Auto Repair Boise',
        'Posts', 'Filters', 'No posts available')}
    `);
    expect(context).toBe('Automotive Repair Shop. Phone: (208) 260-1244. Email: fixitrightautorepairboise@gmail.com.');
  });

  it('group-profile person keeps a clean intro when one exists', () => {
    const { snapshot, context } = scan('/groups/idahoconstruction/user/100001/', `
      <h1>Mark Fulton</h1>
      ${lines('Member of Idaho Construction', 'Joined Facebook in 2014', 'View profile', 'Message')}
      ${lines('Intro', 'Project manager at Fulton Builders')}
      ${lines("Mark's posts in this group", 'Mark Fulton', '2d', 'Anyone have a good excavator for rent near Nampa this week?', 'Like', 'Comment')}
    `);
    expect(snapshot.display_name).toBe('Mark Fulton');
    expect(context).toBe('Project manager at Fulton Builders.');
  });

  it('group-profile person with no intro gets empty context, not group chrome or posts', () => {
    const { snapshot, context } = scan('/groups/idahoconstruction/user/100001/', `
      <h1>Mark Fulton</h1>
      ${lines('Member of Idaho Construction', 'Joined Facebook in 2014', 'View profile', 'Message',
        "Mark's posts in this group", 'Mark Fulton', '2d', 'Anyone have a good excavator for rent near Nampa this week?', 'Like', 'Comment')}
    `);
    expect(snapshot.display_name).toBe('Mark Fulton');
    expect(context).toBe('');
  });

  it('Facebook links and feed-post URLs never become the website', () => {
    const { context } = scan('/somebiz', `
      <h1>Some Biz</h1>
      ${lines('Search', 'Plumbing Service', 'More', 'All', 'About', 'Links', 'facebook.com/somebiz', 'm.me/somebiz',
        'Featured', 'Some Biz', 'Shop now at https://somebiz-preview.myshopify.com', ...FEED_TAIL)}
    `);
    expect(context).toBe('Plumbing Service.');
  });

  it('a stored page dump from an older build is never displayed; current-format context is kept', () => {
    const dump = ['About: Intro', ...PAGE_DUMP, 'Camden Gladden', 'Jessica Tran', 'Great weekend at the lake'].join('\n');
    expect(sanitizeFacebookProspectContext(dump, 'Camden Gladden')).toBe('');
    expect(sanitizeFacebookProspectContext('Owner at Gladden Detailing. Automotive Service. Website: gladden.com.', 'Camden Gladden'))
      .toBe('Owner at Gladden Detailing. Automotive Service. Website: gladden.com.');
    expect(sanitizeFacebookProspectContext("Great bio. What's on your mind? People you may know", 'Camden Gladden')).toBe('');
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
    expect(thread.profile_bio).toBe('Fleet manager at Proditus Logistics.');
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

describe('group-member profiles with no [role="main"] landmark (LIVE)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetFacebookProfileCarryoverForTests();
  });

  it('Paulina Salazar group-member page: reads the Intro from the body, not points, activity or group posts', () => {
    window.history.pushState({}, '', '/groups/1219634021392380/user/100065277902414/');
    document.title = 'Paulina Salazar | Facebook';
    document.body.innerHTML = `
      <h1>Paulina Salazar</h1>
      ${lines('210 points', '102 friends', 'Message', 'Add friend', 'View profile', 'More', 'Group posts', "Paulina's contributions",
        'Intro', 'IG @thelasheffect.ut & @axiseventsut Helping women elevate their beauty, mind and business🔥',
        'Member of Utah Side Hustle and Labor Gigs since January 19, 2026', 'Profile · Digital creator',
        'Recent activity', 'Paulina Salazar liked Mindi Suzunaga’s comment: "Paulina Salazar Yw :)"',
        'Group posts', "I'm looking for someone or a company who can help me distribute hundreds of business flyers?!")}
    `;
    const snapshot = extractFacebookProfileSnapshot();
    const context = snapshot.profile_bio || '';
    expect(snapshot.display_name).toBe('Paulina Salazar');
    expect(context).toContain('IG @thelasheffect.ut & @axiseventsut Helping women elevate their beauty, mind and business');
    expect(context).toContain('Member of Utah Side Hustle and Labor Gigs');
    expect(context).toContain('Digital creator');
    expect(context).not.toMatch(/points|liked|flyers|Mindi/);
    expect(JSON.parse(document.documentElement.getAttribute('data-brevmont-fb-scan') || '{}')).toMatchObject({ root: 'body', build: 'fb-context-6' });
  });

  it('Aleem Iqbal (LIVE line order): header bio with links, category, company, Personal details and website', () => {
    window.history.pushState({}, '', '/aleem.iqbal.bhatti');
    document.body.innerHTML = `<div role="main"><h1>Aleem Iqbal</h1>${lines('21K followers • 309 following', 'Message', 'Follow', 'Search',
      'Founder of SemanticsX: https://www.semanticsx.com/', 'YT: https://www.youtube.com/c/AleemIqbal', 'Digital creator', 'SemanticsX', 'More',
      'All', 'About', 'Reels', 'Photos', 'Friends', 'More', 'Personal details', 'Lives in Islamabad, Pakistan', 'From Islamabad, Pakistan', 'Male',
      'See more personal details', 'Links', 'semanticsx.com', 'Posts', 'Filters', 'Pinned post', 'Aleem Iqbal', 'SEOSignalX — 50% OFF for 24 Hours')}</div>`;
    const context = extractFacebookProfileSnapshot().profile_bio || '';
    expect(context).toContain('Founder of SemanticsX');
    expect(context).toContain('Digital creator');
    expect(context).toContain('Lives in Islamabad, Pakistan');
    expect(context).toContain('semanticsx.com');
    expect(context).not.toMatch(/SEOSignalX|50% OFF|Male/);
  });

  it('Starter Story (LIVE line order): bio, category and website', () => {
    window.history.pushState({}, '', '/starterstoryofficial');
    document.body.innerHTML = `<div role="main"><h1>Starter Story</h1>${lines('3.1K followers • 3 following', 'Learn more', 'Follow', 'Search',
      'Sharing business ideas that make money!', 'Business & Economy Website', 'More', 'All', 'About', 'Reels', 'Photos', 'Followers', 'More',
      'Details', '3 reviews', 'Links', 'starterstory.com', 'Contact info', 'pat@starterstory.com', 'Posts', 'Filters', 'Starter Story', '4 hours ago',
      'This dude Timo built a $50K/month app working just 20 hours a month')}</div>`;
    const context = extractFacebookProfileSnapshot().profile_bio || '';
    expect(context).toBe('Sharing business ideas that make money! Business & Economy Website. Website: starterstory.com. Email: pat@starterstory.com.');
  });
});

describe('SPA navigation leaves the previous page mounted (LIVE root cause)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetFacebookProfileCarryoverForTests();
  });

  it('reads the current profile region, not the hidden feed [role="main"] kept from the previous route', () => {
    window.history.pushState({}, '', '/JeremyLeeMiner');
    document.title = 'Facebook';
    document.body.innerHTML = `
      <div role="main" hidden>${lines('Create a post', "What's on your mind, Yancy?", 'Stories', 'Create story', 'Your story', 'Angel Velaz', 'Sponsored')}</div>
      <div role="main"><h1>Jeremy Miner</h1>${lines('498K followers • 321 following', 'Following', 'Message', 'Search',
        'Companies come to us when they are frustrated by losing sales to low cost competitors, concerned about high attrition with their sales teams and worried about inconsistently hitting their sales targets.',
        'CEO and Founder', 'Public figure', 'More', 'All', 'About', 'Reels', 'Photos', 'Followers', 'More',
        'Links', '7thlevelhq.com', 'Contact info', '(800) 656-8534', 'jeremy@7thlevelhqteam.com', 'Jeremy Miner', 'Posts', 'Filters',
        'Jeremy Miner', '4 hours ago', "You're causing objections... not the prospect.")}</div>`;
    const snapshot = extractFacebookProfileSnapshot();
    const context = snapshot.profile_bio || '';
    expect(snapshot.display_name).toBe('Jeremy Miner');
    expect(context).toContain('Companies come to us when they are frustrated by losing sales');
    expect(context).toContain('CEO and Founder');
    expect(context).toContain('Public figure');
    expect(context).toContain('Website: 7thlevelhq.com');
    expect(context).toContain('Phone: (800) 656-8534');
    expect(context).toContain('Email: jeremy@7thlevelhqteam.com');
    expect(context).not.toMatch(/What's on your mind|Create a post|Angel Velaz|causing objections/);
    expect(JSON.parse(document.documentElement.getAttribute('data-brevmont-fb-scan') || '{}')).toMatchObject({ root: 'main#1/2', build: 'fb-context-6' });
  });

  it('Super Contractor Group (LIVE): header services + category, Personal details, phone; rating dropped', () => {
    window.history.pushState({}, '', '/profile.php?id=61585991909727');
    document.body.innerHTML = `
      <div role="main" hidden>${lines('Create a post', "What's on your mind, Yancy?")}</div>
      <div role="main"><h1>Super Contractor Group</h1>${lines('2 followers • 1 following', 'WhatsApp', 'Message', 'Follow',
        'Screen enclosure- Screen room- concrete- Pavers- Structural Drawing - Re screening', 'Construction Company', 'More',
        'All', 'About', 'Followers', 'Photos', 'Mentions', 'More', 'Personal details', 'Lives in Orlando, Florida', 'Ingles and Spanish',
        'Details', 'Not yet rated (0 reviews)', 'Contact info', '(407) 529-7361', 'Super Contractor Group', 'Photos', 'See all photos')}</div>`;
    const context = extractFacebookProfileSnapshot().profile_bio || '';
    expect(context).toContain('Screen enclosure- Screen room- concrete- Pavers');
    expect(context).toContain('Construction Company');
    expect(context).toContain('Lives in Orlando, Florida');
    expect(context).toContain('Phone: (407) 529-7361');
    expect(context).not.toMatch(/Not yet rated|What's on your mind/);
  });
});

describe('clicking from a normal profile to a group-member card (LIVE)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetFacebookProfileCarryoverForTests();
  });

  it('Jonathan Montoya: ignores the previous profile\'s hidden [role="main"] and reads the card from the body', () => {
    window.history.pushState({}, '', '/groups/698593531630485/user/1300831178');
    document.title = 'Jonathan Montoya | Facebook';
    document.body.innerHTML = `
      <div role="main" hidden><h1>Jeremy Miner</h1>${lines('Companies come to us when they are frustrated by losing sales', 'Links', '7thlevelhq.com')}</div>
      <div><h1>Jonathan Montoya</h1>${lines('30,528 points', 'Admin', '•', '4842 friends', 'Message', 'Add friend', 'View profile', 'More',
        'Group posts', "Jonathan's contributions", 'Intro',
        'I help YOU create an AI software + Customers all in 1 day 👉 https://getmakerai.com',
        'Admin of AI: Artificial Intelligence since August 9, 2025', 'Profile · Digital creator',
        'Badges', 'Admin', 'Group expert', 'All-star contributor', 'Recent photos', 'Recent activity',
        'Jonathan Montoya commented on Suzanne Taylor’s post: "🙏🙏"')}</div>`;
    const snapshot = extractFacebookProfileSnapshot();
    const context = snapshot.profile_bio || '';
    expect(snapshot.display_name).toBe('Jonathan Montoya');
    expect(context).toContain('I help YOU create an AI software + Customers all in 1 day');
    expect(context).toContain('getmakerai.com');
    expect(context).toContain('Admin of AI: Artificial Intelligence');
    expect(context).toContain('Digital creator');
    expect(context).not.toMatch(/Jeremy|7thlevelhq|4842 friends|points|Group expert|commented/);
  });

  it('Adrees AI Automation (LIVE): intro with link, admin role and Entrepreneur category', () => {
    window.history.pushState({}, '', '/groups/1576900073381388/user/61555901316761/');
    document.body.innerHTML = `<div><h1>Adrees AI Automation</h1>${lines('20,145 points', 'Admin', 'Message', 'Add friend', 'View profile', 'More',
      'Group posts', "Adrees's contributions", 'Intro',
      'I help you adopt AI | adreesai.gumroad.com/l/premium_guides | DM “SYSTEM” to work together:',
      'Admin of Claude Ai Builders since March 29, 2026', 'Profile · Entrepreneur', 'Badges', 'Admin', 'All-star contributor', 'Recent photos')}</div>`;
    const context = extractFacebookProfileSnapshot().profile_bio || '';
    expect(context).toContain('I help you adopt AI');
    expect(context).toContain('Admin of Claude Ai Builders');
    expect(context).toContain('Entrepreneur');
    expect(context).not.toMatch(/points|All-star/);
  });

  it('Bitkey (LIVE): Contact info handles row becomes Social handles', () => {
    window.history.pushState({}, '', '/profile.php?id=100088526238789');
    document.body.innerHTML = `<div role="main"><h1>Bitkey</h1>${lines('3.5K followers • 0 following', 'Learn more', 'Message', 'Follow',
      'Bitkey is the self-custody bitcoin wallet with an app, hardware, and recovery tools. Built by the team at Block, Inc.',
      'Business Center', 'More', 'All', 'About', 'Reels', 'Photos', 'Followers', 'More', 'Details', '3 reviews', 'Links', 'bitkey.world',
      'Contact info', 'ownbitkey · bitkeyofficial', 'Bitkey', 'Posts', 'Filters')}</div>`;
    const context = extractFacebookProfileSnapshot().profile_bio || '';
    expect(context).toContain('Website: bitkey.world');
    expect(context).toContain('Social: @ownbitkey / @bitkeyofficial.');
    expect(context).not.toMatch(/ownbitkey\. ·|3 reviews/);
  });
});
