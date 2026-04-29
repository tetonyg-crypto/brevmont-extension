/**
 * Tool: telemetry.ts
 * Purpose: Batched telemetry client — POSTs extension events to Brevmont proxy
 * Inputs: event_type + metadata
 * Outputs: Best-effort delivery; never crashes the main flow
 * Dependencies: chrome.storage.local, chrome.runtime, fetch
 * Last Updated: 2026-04-29
 * Changelog:
 *   - 2026-04-17: Initial creation — Phase 1e extension hardening
 *   - 2026-04-29: Wire scrubPIIDeep into track()/trackError() so
 *                 customer names/emails/phones from CRM DOM never leave
 *                 the browser in error_message / stack / metadata fields.
 */

import { scrubPII, scrubPIIDeep } from './pii';

const PROXY_URL = 'https://oper8er-proxy-production.up.railway.app';

export type TelemetrySeverity = 'info' | 'warn' | 'error' | 'critical';

export interface TelemetryPayload {
  event_type: string;
  error_message?: string;
  stack?: string;
  platform?: string;
  purpose?: string;
  chrome_version?: string;
  extension_version?: string;
  severity?: TelemetrySeverity;
  metadata?: Record<string, any>;
  captured_at?: string;
}

function parseChromeVersion(): string {
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const m = ua.match(/Chrome\/([\d.]+)/);
    return m ? m[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

function getExtensionVersion(): string {
  try {
    const m = chrome?.runtime?.getManifest?.();
    return m?.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

class Telemetry {
  private queue: TelemetryPayload[] = [];
  private BATCH_SIZE = 10;
  private FLUSH_INTERVAL_MS = 30000;
  private flushing = false;

  constructor() {
    try {
      setInterval(() => { this.flush().catch(() => {}); }, this.FLUSH_INTERVAL_MS);
    } catch {}
    try {
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('beforeunload', () => { this.flush().catch(() => {}); });
      }
    } catch {}
  }

  track(event_type: string, data: Partial<TelemetryPayload> = {}): void {
    try {
      // Scrub before queueing so the queue itself never contains PII —
      // protects against future bugs that flush mid-debug or persist the
      // queue to storage. error_message + stack are scrubbed flat;
      // metadata + everything else gets recursive scrubPIIDeep.
      const payload: TelemetryPayload = {
        event_type,
        extension_version: data.extension_version || getExtensionVersion(),
        chrome_version: data.chrome_version || parseChromeVersion(),
        captured_at: new Date().toISOString(),
        ...data,
        error_message: data.error_message != null ? scrubPII(data.error_message) : data.error_message,
        stack: data.stack != null ? scrubPII(data.stack) : data.stack,
        metadata: data.metadata != null ? scrubPIIDeep(data.metadata) : data.metadata,
      };
      this.queue.push(payload);
      if (this.queue.length >= this.BATCH_SIZE || payload.severity === 'critical') {
        this.flush().catch(() => {});
      }
    } catch {
      // never crash
    }
  }

  trackError(err: Error | any, ctx: Record<string, any> = {}): void {
    try {
      // PII-scrub at intake. Error messages from VinSolutions DOM-extraction
      // failures often quote the customer name or email back at us; we don't
      // need those server-side and they're a compliance liability.
      this.track('error', {
        error_message: scrubPII((err?.message || String(err || 'unknown')).slice(0, 500)),
        stack: scrubPII((err?.stack || '').toString().slice(0, 2000)),
        severity: 'error',
        metadata: scrubPIIDeep(ctx || {}),
      });
    } catch {}
  }

  trackSelectorFailure(platform: string, purpose: string, reason: string): void {
    try {
      const severity: TelemetrySeverity = reason === 'all_failed' ? 'critical' : 'warn';
      this.track('selector_failure', {
        platform,
        purpose,
        severity,
        metadata: { reason },
      });
    } catch {}
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.queue.length === 0) return;
    this.flushing = true;
    try {
      const batch = this.queue.splice(0, this.queue.length);
      let token: string | undefined;
      try {
        const r = await chrome.storage.local.get(['dealer_token']);
        token = r?.dealer_token as string | undefined;
      } catch {
        token = undefined;
      }
      if (!token) {
        // no token yet — drop silently, events are best-effort
        return;
      }
      // Fire each event individually — proxy endpoint accepts one payload per call.
      // Wrapped in try/catch and awaited in parallel but with failure isolation.
      await Promise.all(batch.map(async (evt) => {
        try {
          await fetch(`${PROXY_URL}/v1/telemetry/extension`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(evt),
          });
        } catch {
          // silently drop — never block main flow
        }
      }));
    } catch {
      // never throw
    } finally {
      this.flushing = false;
    }
  }
}

export const telemetry = new Telemetry();
