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
};

/** Resolve the platform id from a URL. Mirrors the current
 *  content.ts PLATFORM logic but centralized. */
export function platformIdFromUrl(url: string): PlatformId | null {
  const u = String(url || '').toLowerCase();
  if (u.includes('vinsolutions.com') || u.includes('coxautoinc.com')) return 'vinsolutions';
  if (u.includes('mail.google.com')) return 'gmail';
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
