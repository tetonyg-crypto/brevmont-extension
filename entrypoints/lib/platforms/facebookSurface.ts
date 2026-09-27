export type FacebookSurface =
  | 'profile_direct'
  | 'profile_numeric'
  | 'profile_group_member'
  | 'profile_people'
  | 'messenger_thread'
  | 'marketplace_thread'
  | 'home_feed'
  | 'group_feed'
  | 'unsupported';

export interface FacebookSurfaceInfo {
  surface: FacebookSurface;
  supported: boolean;
  route_key: string;
  profile_id: string | null;
  username: string | null;
  canonical_profile_url: string | null;
}

const FB_RESERVED_PATHS = new Set([
  'messages', 'marketplace', 'groups', 'pages', 'watch', 'gaming', 'events',
  'friends', 'notifications', 'settings', 'help', 'ads', 'business',
  'bookmarks', 'stories', 'reel', 'reels', 'live', 'jobs', 'dating',
  'weather', 'games', 'offers', 'saved', 'memories', 'hashtag', 'photo',
  'photos', 'video', 'videos', 'login', 'recover', 'policies', 'about',
  'legal', 'privacy', 'terms', 'campaign', 'plugins', 'sharer', 'dialog',
  'tr', 'l.php', 'profile.php', 'checkpoint', 'mbasic', 'ads_manager',
  'permalink.php', 'story.php', 'search', 'find-friends', 'allactivity',
  'home.php', 'groups.php', 'pages.php', 'people',
]);

function empty(surface: FacebookSurface, routeKey: string): FacebookSurfaceInfo {
  return {
    surface,
    supported: false,
    route_key: routeKey,
    profile_id: null,
    username: null,
    canonical_profile_url: null,
  };
}

/**
 * Classify the Facebook page before reading any DOM. Facebook is a large SPA:
 * merely being on facebook.com does not mean a prospect is open. Keeping this
 * decision URL-first prevents feed/navigation chrome from becoming a lead.
 */
export function classifyFacebookSurface(value: string): FacebookSurfaceInfo {
  try {
    const url = value.includes('://') ? new URL(value) : new URL(value, 'https://www.facebook.com');
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    const routeKey = `${host}${path}${url.search}`;
    if (!(host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'messenger.com' || host.endsWith('.messenger.com'))) {
      return empty('unsupported', routeKey);
    }

    const marketplace = path.match(/^\/marketplace\/t\/([^/?#]+)/i);
    if (marketplace) {
      return { ...empty('marketplace_thread', routeKey), supported: true, route_key: `mp:${marketplace[1]}` };
    }
    const messenger = path.match(/^(?:\/messages)?\/t\/([^/?#]+)/i);
    if (messenger) {
      return { ...empty('messenger_thread', routeKey), supported: true, route_key: `msg:${messenger[1]}` };
    }

    const groupMember = path.match(/^\/groups\/[^/]+\/user\/(\d+)/i);
    if (groupMember) {
      const id = groupMember[1];
      return {
        surface: 'profile_group_member',
        supported: true,
        route_key: `fb_profile:id:${id}`,
        profile_id: id,
        username: null,
        canonical_profile_url: `https://www.facebook.com/profile.php?id=${id}`,
      };
    }

    if (path.toLowerCase() === '/profile.php') {
      const id = url.searchParams.get('id');
      if (!id) return empty('unsupported', routeKey);
      return {
        surface: 'profile_numeric',
        supported: true,
        route_key: `fb_profile:id:${id}`,
        profile_id: id,
        username: null,
        canonical_profile_url: `https://www.facebook.com/profile.php?id=${encodeURIComponent(id)}`,
      };
    }

    const people = path.match(/^\/people\/[^/]+\/(\d+)/i);
    if (people) {
      const id = people[1];
      return {
        surface: 'profile_people',
        supported: true,
        route_key: `fb_profile:id:${id}`,
        profile_id: id,
        username: null,
        canonical_profile_url: `https://www.facebook.com/profile.php?id=${id}`,
      };
    }

    if (path === '/' || path.toLowerCase() === '/home.php') return empty('home_feed', routeKey);
    if (/^\/groups(?:\/[^/]+)?$/i.test(path)) return empty('group_feed', routeKey);

    const direct = path.match(/^\/([A-Za-z0-9.]{1,60})$/);
    if (direct && !FB_RESERVED_PATHS.has(direct[1].toLowerCase())) {
      const username = direct[1];
      return {
        surface: 'profile_direct',
        supported: true,
        route_key: `fb_profile:${username.toLowerCase()}`,
        profile_id: null,
        username,
        canonical_profile_url: `https://www.facebook.com/${username}`,
      };
    }

    return empty('unsupported', routeKey);
  } catch {
    return empty('unsupported', String(value || ''));
  }
}

export function isFacebookProfileSurface(surface: FacebookSurface): boolean {
  return surface.startsWith('profile_');
}
