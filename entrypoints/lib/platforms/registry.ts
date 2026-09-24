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
