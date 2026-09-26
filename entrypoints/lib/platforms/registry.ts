/**
 * Platform adapter registry — one PlatformAdapter per surface.
 *
 * The core (content.ts message handlers) calls `resolveAdapter()` to
 * get the adapter for the current tab, then delegates scan / extract /
 * inject to it.
 *
 * Adapters are lazy-imported so an unrelated frame (e.g. an iframe
 * on a totally different domain) never pays the parse cost for
 * every platform.
 */

import type { PlatformAdapter, PlatformId } from './types';

type LazyAdapter = () => Promise<PlatformAdapter>;

const REGISTRY: Record<PlatformId, LazyAdapter> = {
  facebook: () => import('./facebook').then((m) => m.facebookAdapter),
  gmail: () => import('./gmail').then((m) => m.gmailAdapter),
  outlook: () => import('./outlook').then((m) => m.outlookAdapter),
  linkedin: () => import('./linkedin').then((m) => m.linkedinAdapter),
  vinsolutions: () => import('./vinsolutions').then((m) => m.vinsolutionsAdapter),
  instagram: () => import('./instagram').then((m) => m.instagramAdapter),
  whatsapp: () => import('./whatsapp').then((m) => m.whatsappAdapter),
  'google-messages': () => import('./google-messages').then((m) => m.googleMessagesAdapter),
  cargurus: () => import('./cargurus').then((m) => m.cargurusAdapter),
  carsdotcom: () => import('./carsdotcom').then((m) => m.carsdotcomAdapter),
  autotrader: () => import('./autotrader').then((m) => m.autotraderAdapter),
  dealersocket: () => import('./dealersocket').then((m) => m.dealersocketAdapter),
  elead: () => import('./elead').then((m) => m.eleadAdapter),
  x: () => import('./x').then((m) => m.xAdapter),
};

/** Resolve the platform id from a URL. Mirrors the current
 *  content.ts PLATFORM logic but centralized. */
export function platformIdFromUrl(url: string): PlatformId | null {
  const u = String(url || '').toLowerCase();
  if (u.includes('vinsolutions.com') || u.includes('coxautoinc.com')) return 'vinsolutions';
  if (u.includes('mail.google.com')) return 'gmail';
  if (u.includes('outlook.live.com') || u.includes('outlook.office.com') || u.includes('outlook.office365.com')) return 'outlook';
  if (u.includes('messenger.com') || u.includes('facebook.com/messages') || u.includes('facebook.com/marketplace/t/')) return 'facebook';
  if (u.includes('facebook.com')) return 'facebook';
  if (u.includes('linkedin.com')) return 'linkedin';
  if (u.includes('instagram.com/direct')) return 'instagram';
  // Instagram profile pages (instagram.com/<username>/) — added 2026-09-26.
  // Confirmed live: "+Lead > Scan This Page" on a real profile
  // (instagram.com/cardogvlogs/) failed with "no_adapter_for_url" because
  // only /direct thread routes were ever recognized. A bare single path
  // segment is a profile; excludes Instagram's own reserved top-level
  // routes so /explore, /reels, etc. are never mistaken for a username.
  if (/instagram\.com\/([a-z0-9._]{1,40})\/?(?:[?#]|$)/i.test(u)) {
    const seg = u.match(/instagram\.com\/([a-z0-9._]{1,40})\/?(?:[?#]|$)/i)?.[1]?.toLowerCase() || '';
    const IG_RESERVED = new Set(['direct', 'explore', 'reels', 'reel', 'stories', 'accounts', 'about', 'legal', 'p', 'tv', 'developer', 'privacy', 'terms', 'challenge', 'emails']);
    if (seg && !IG_RESERVED.has(seg)) return 'instagram';
  }
  if (u.includes('web.whatsapp.com')) return 'whatsapp';
  if (u.includes('messages.google.com')) return 'google-messages';
  if (u.includes('cargurus.com')) return 'cargurus';
  if (u.includes('cars.com')) return 'carsdotcom';
  if (u.includes('autotrader.com')) return 'autotrader';
  if (u.includes('dealersocket.com')) return 'dealersocket';
  if (u.includes('elead-crm.com') || u.includes('eleadcrm.com')) return 'elead';
  // X (x.com) DM/XChat routing — added 2026-09-23, patterned after the
  // instagram.com/direct narrow-gating precedent above. Only an actual
  // conversation route counts: x.com/i/chat/<id> (the route confirmed
  // in the founder spec), x.com/messages/<id>-<id> (legacy Twitter DM
  // conversation id shape), or the bare inbox root (so
  // hasOpenXThread()-equivalent gating, not this router, is what says
  // "no thread selected"). Deliberately excludes /messages/compose
  // (composing a NEW message, not an existing thread) and bare
  // x.com/home, x.com/<username>, x.com/<username>/status/<id> — those
  // are feed/profile/post pages, never an active DM thread.
  //
  // CONFIRMED LIVE (2026-09-23, via automated Chrome navigation):
  // clicking "Messages" on real X redirects to the BARE route
  // `x.com/i/chat` — no trailing slash, no `/messages` anywhere in the
  // URL at all. The original `x.com/i/chat/` check (trailing slash
  // required) and the `/messages` checks below both miss this exact
  // shape, so bare inbox-root silently fell through to `null` (X not
  // recognized as a platform at all, rather than "X detected, no
  // thread selected"). The bare-chat check below fixes that; it's
  // still narrow (no id after `/chat`, so `/i/chat/<id>` is unaffected
  // and still handled by the check above it).
  if (u.includes('x.com/i/chat/')) return 'x';
  if (/x\.com\/i\/chat\/?(?:[?#]|$)/.test(u)) return 'x';
  if (/x\.com\/messages\/\d+-\d+(?:[/?#]|$)/.test(u)) return 'x';
  if (/x\.com\/messages\/?(?:[?#]|$)/.test(u)) return 'x';
  // X profile pages (x.com/<handle>) — added 2026-09-26. Confirmed live:
  // the chip already detects the profile (generic title-based fallback),
  // but "+Lead > Scan This Page" failed with "no_adapter_for_url" since
  // only DM routes were ever recognized. Excludes X's own reserved
  // top-level routes so /home, /messages, /i/..., etc. are never mistaken
  // for a handle. Also excludes a status/post permalink
  // (x.com/<handle>/status/<id>) per the founder's original spec — that's
  // a post, not a profile.
  if (/^x\.com\/([a-z0-9_]{1,15})\/?(?:[?#]|$)/i.test(u.replace(/^https?:\/\//, ''))) {
    const seg = u.replace(/^https?:\/\//, '').match(/^x\.com\/([a-z0-9_]{1,15})\/?(?:[?#]|$)/i)?.[1]?.toLowerCase() || '';
    const X_RESERVED = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'search', 'settings', 'compose', 'jobs', 'premium_sign_up', 'about', 'tos', 'privacy', 'help', 'lists', 'bookmarks', 'communities']);
    if (seg && !X_RESERVED.has(seg)) return 'x';
  }
  return null;
}

let currentAdapter: PlatformAdapter | null = null;
let currentAdapterId: PlatformId | null = null;

/** Get (or lazily import + cache) the adapter for the current tab. */
export async function resolveAdapter(url?: string): Promise<PlatformAdapter | null> {
  const target = url || (typeof window !== 'undefined' ? window.location.href : '');
  const id = platformIdFromUrl(target);
  if (!id) return null;
  if (currentAdapterId === id && currentAdapter) return currentAdapter;
  try {
    const adapter = await REGISTRY[id]();
    currentAdapterId = id;
    currentAdapter = adapter;
    return adapter;
  } catch (err) {
    // Adapter module doesn't exist yet (Phase 3 not-yet-shipped
    // surface). Return null so the core falls back to legacy paths.
    return null;
  }
}

/** For tests / debug: reset the cached adapter. */
export function resetAdapterCache(): void {
  currentAdapter = null;
  currentAdapterId = null;
}
