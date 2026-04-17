/**
 * Tool: selectors.ts
 * Purpose: Remote-config selector manager — fetches per-platform selectors from
 *          proxy, caches in-memory + chrome.storage.local, and applies fallbacks.
 * Inputs: platform name, purpose
 * Outputs: Resolved DOM element(s), plus telemetry on fallback/failure
 * Dependencies: chrome.storage.local, fetch, telemetry
 * Last Updated: 2026-04-17
 * Changelog:
 *   - 2026-04-17: Initial creation — Phase 1f extension hardening
 */

import { telemetry } from './telemetry';

const PROXY_URL = 'https://oper8er-proxy-production.up.railway.app';

export interface SelectorEntry {
  purpose: string;
  selector_primary: string;
  selector_fallbacks: string[];
  attribute_check?: { attr: string; contains: string } | null;
  version?: number | string;
  rollout_percent?: number;
  platform?: string;
}

interface CachedEntry {
  data: SelectorEntry[];
  ts: number;
}

const MEM_TTL_MS = 60 * 60 * 1000; // 1 hour

class SelectorManager {
  private memCache: Map<string, CachedEntry> = new Map();
  private inflight: Map<string, Promise<SelectorEntry[]>> = new Map();

  async getSelectors(platform: string): Promise<SelectorEntry[]> {
    const p = (platform || 'unknown').toLowerCase();
    const cached = this.memCache.get(p);
    if (cached && Date.now() - cached.ts < MEM_TTL_MS) {
      return cached.data;
    }

    // De-dupe concurrent fetches
    if (this.inflight.has(p)) {
      return this.inflight.get(p)!;
    }

    const promise = (async (): Promise<SelectorEntry[]> => {
      try {
        const resp = await fetch(`${PROXY_URL}/v1/selectors?platform=${encodeURIComponent(p)}`);
        if (!resp.ok) throw new Error(`selectors fetch ${resp.status}`);
        const data = await resp.json();
        const selectors: SelectorEntry[] = Array.isArray(data?.selectors) ? data.selectors : [];
        // Tag platform onto every entry for downstream reporting
        for (const s of selectors) s.platform = p;
        this.memCache.set(p, { data: selectors, ts: Date.now() });
        try {
          await chrome.storage.local.set({
            ['selectors_' + p]: selectors,
            ['selectors_' + p + '_ts']: Date.now(),
          });
        } catch {}
        return selectors;
      } catch (err: any) {
        // Fall back to persisted storage
        try {
          const r = await chrome.storage.local.get(['selectors_' + p, 'selectors_' + p + '_ts']);
          const stored = r['selectors_' + p] as SelectorEntry[] | undefined;
          if (Array.isArray(stored) && stored.length) {
            for (const s of stored) s.platform = p;
            this.memCache.set(p, { data: stored, ts: Date.now() });
            telemetry.track('selectors_from_storage', { platform: p, severity: 'warn', metadata: { reason: err?.message || 'fetch_failed' } });
            return stored;
          }
        } catch {}
        telemetry.track('selectors_unavailable', { platform: p, severity: 'warn', metadata: { reason: err?.message || 'fetch_failed' } });
        return [];
      } finally {
        this.inflight.delete(p);
      }
    })();

    this.inflight.set(p, promise);
    return promise;
  }

  private findEntry(selectors: SelectorEntry[] | null | undefined, purpose: string): SelectorEntry | null {
    if (!selectors || !selectors.length) return null;
    for (const s of selectors) {
      if (s.purpose === purpose) return s;
    }
    return null;
  }

  private checkAttribute(el: Element | null, check: { attr: string; contains: string } | null | undefined): boolean {
    if (!check) return true;
    if (!el) return false;
    try {
      const v = (el as HTMLElement).getAttribute(check.attr) || '';
      return v.indexOf(check.contains) !== -1;
    } catch {
      return false;
    }
  }

  query(
    selectors: SelectorEntry[] | null | undefined,
    purpose: string,
    root: Document | HTMLElement = document,
    platformOverride?: string,
  ): Element | null {
    const entry = this.findEntry(selectors, purpose);
    const platform = platformOverride || entry?.platform || (selectors && selectors[0]?.platform) || 'unknown';
    if (!entry) {
      telemetry.trackSelectorFailure(platform, purpose, 'no_entry');
      return null;
    }
    // Try primary
    try {
      const el = (root as Document).querySelector(entry.selector_primary);
      if (el && this.checkAttribute(el, entry.attribute_check)) return el;
    } catch {}
    // Try each fallback
    const fallbacks = Array.isArray(entry.selector_fallbacks) ? entry.selector_fallbacks : [];
    for (let i = 0; i < fallbacks.length; i++) {
      const sel = fallbacks[i];
      try {
        const el = (root as Document).querySelector(sel);
        if (el && this.checkAttribute(el, entry.attribute_check)) {
          telemetry.track('selector_fallback_used', {
            platform,
            purpose,
            severity: 'warn',
            metadata: { fallback_index: i, selector: sel },
          });
          return el;
        }
      } catch {}
    }
    telemetry.trackSelectorFailure(platform, purpose, 'all_failed');
    return null;
  }

  queryAll(
    selectors: SelectorEntry[] | null | undefined,
    purpose: string,
    root: Document | HTMLElement = document,
    platformOverride?: string,
  ): Element[] {
    const entry = this.findEntry(selectors, purpose);
    const platform = platformOverride || entry?.platform || (selectors && selectors[0]?.platform) || 'unknown';
    if (!entry) {
      telemetry.trackSelectorFailure(platform, purpose, 'no_entry');
      return [];
    }
    // Try primary
    try {
      const els = (root as Document).querySelectorAll(entry.selector_primary);
      const kept: Element[] = [];
      els.forEach(el => { if (this.checkAttribute(el, entry.attribute_check)) kept.push(el); });
      if (kept.length) return kept;
    } catch {}
    // Try fallbacks
    const fallbacks = Array.isArray(entry.selector_fallbacks) ? entry.selector_fallbacks : [];
    for (let i = 0; i < fallbacks.length; i++) {
      const sel = fallbacks[i];
      try {
        const els = (root as Document).querySelectorAll(sel);
        const kept: Element[] = [];
        els.forEach(el => { if (this.checkAttribute(el, entry.attribute_check)) kept.push(el); });
        if (kept.length) {
          telemetry.track('selector_fallback_used', {
            platform,
            purpose,
            severity: 'warn',
            metadata: { fallback_index: i, selector: sel },
          });
          return kept;
        }
      } catch {}
    }
    telemetry.trackSelectorFailure(platform, purpose, 'all_failed');
    return [];
  }
}

export const selectorManager = new SelectorManager();
