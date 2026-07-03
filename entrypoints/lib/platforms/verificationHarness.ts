/**
 * Universal Capture — verification harness.
 *
 * Rep opens the target platform (logged in), pops DevTools console
 * on that tab, runs one of:
 *
 *   await window.__brevmontVerify.runScan()            // scan + adapter status
 *   await window.__brevmontVerify.runInject("hello")   // scan + inject + verify
 *   await window.__brevmontVerify.captureBundle()      // full evidence bundle → server
 *   await window.__brevmontVerify.dealerKit()          // dealer-inbox variant: same as captureBundle but
 *                                                      //   ALSO captures DOM snapshot for adapter authoring
 *
 * Each returns a structured object AND (for captureBundle / dealerKit)
 * posts to /api/capture-evidence so the founder can inspect the
 * bundle from admin.brevmont.com/verification-evidence/<id>.
 */

import type { PlatformAdapter } from './types';
import { resolveAdapter } from './registry';
import { pickCleanName, verifyInject } from './shared';

interface HarnessResult {
  ok: boolean;
  reason?: string;
  platform?: string;
  adapter_present?: boolean;
  scan?: unknown;
  inject?: unknown;
  evidence_id?: string;
  server_error?: string;
  view_url?: string;
}

const TEST_INJECT_TEXT = '[brevmont verify — safe to delete]';
const PAGE_REQUEST_SOURCE = 'brevmont:verify:page';
const CONTENT_RESPONSE_SOURCE = 'brevmont:verify:content';

async function getBackgroundStorage(): Promise<{
  rep_auth_token?: string;
  dealer_token?: string;
  api_base_url?: string;
}> {
  try {
    return await chrome.storage.local.get(['rep_auth_token', 'dealer_token', 'api_base_url']);
  } catch {
    return {};
  }
}

async function apiPost(path: string, body: unknown): Promise<{ ok: boolean; status: number; json?: any; text?: string }> {
  const cfg = await getBackgroundStorage();
  const base = cfg.api_base_url || 'https://api.brevmont.com';
  const token = cfg.rep_auth_token || cfg.dealer_token;
  if (!token) return { ok: false, status: 0, text: 'no_rep_auth_token_in_extension_storage' };
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Rep-Token': token,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const ct = res.headers.get('content-type') || '';
    const json = ct.includes('application/json') ? await res.json().catch(() => null) : null;
    const text = json ? JSON.stringify(json) : await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, json, text };
  } catch (err: any) {
    return { ok: false, status: 0, text: err?.message || 'fetch_failed' };
  }
}

async function captureScreenshotViaExtension(): Promise<string | null> {
  // The harness runs in the page context, not the background service
  // worker. It sends a message to the background asking for a screenshot
  // of the active tab. The background handler (added in this commit)
  // calls chrome.tabs.captureVisibleTab and returns the data URL.
  try {
    const res: any = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'CAPTURE_ACTIVE_TAB_PNG' }, (r) => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(r);
      });
    });
    return res?.ok && typeof res.data_url === 'string' ? res.data_url : null;
  } catch {
    return null;
  }
}

function domSnapshot(): string {
  // Prefer role="main" — the meaningful content region. Falls back to
  // body innerHTML. Size-capped by the server (512 KB) — this trims
  // conservatively to keep the request small.
  try {
    const anchor =
      (document.querySelector('[role="main"]') as HTMLElement | null) ||
      (document.querySelector('main') as HTMLElement | null) ||
      document.body;
    if (!anchor) return '';
    return anchor.outerHTML.slice(0, 400_000);
  } catch {
    return '';
  }
}

async function runScanInternal(): Promise<{ adapter: PlatformAdapter | null; scan: any }> {
  const adapter = await resolveAdapter(window.location.href);
  if (!adapter || !adapter.detect()) return { adapter: null, scan: { ok: false, reason: 'no_adapter_for_url' } };
  const thread = adapter.scrapeThread();
  const adapterCustomer = adapter.extractCustomer();
  const context = adapter.extractContext();
  const clean = pickCleanName([adapterCustomer]);
  return {
    adapter,
    scan: {
      ok: true,
      platform: adapter.id,
      adapter_id: adapter.id,
      capabilities: adapter.capabilities,
      thread,
      customer: clean || { name: null },
      context,
      customerName: clean?.name || null,
      vehicle: context.vehicle || null,
      detectionConfidence: clean?.confidence ?? 0,
      detectionMethod: clean?.raw_source || 'adapter',
    },
  };
}

async function runInjectInternal(adapter: PlatformAdapter, text: string) {
  const plan = await adapter.inject(text, adapter.capabilities.default_output);
  if (!plan.ok || !plan.composer_selector) {
    return { ok: false, reason: plan.reason || 'no_composer', method: plan.method };
  }
  const composer = document.querySelector(plan.composer_selector.split(' >>> ')[0]) as HTMLElement | null;
  if (!composer) {
    return { ok: false, reason: 'composer_selector_resolved_null', selector: plan.composer_selector };
  }
  // Prefer the existing safeInjectText via the content-script bridge
  // so the double-inject fix + isDuplicateInject gate stay in the
  // trusted path. Send the message and wait for the reply.
  const injectRes: any = await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'INJECT_CONTENT_V2', payload: { text, kind: adapter.capabilities.default_output } },
      (r) => resolve(r || { ok: false, reason: 'runtime_no_response' })
    );
  });
  // Verify from the harness side too (belt + suspenders).
  const verify = await verifyInject(composer, text);
  return {
    ok: injectRes?.ok !== false,
    inject_response: injectRes,
    verify_reharness: verify,
    method: injectRes?.method || plan.method || null,
    composer_selector: plan.composer_selector,
    verified: verify.verified,
    verify_elapsed_ms: verify.elapsed_ms,
    test_text: text,
  };
}

async function runScan(): Promise<HarnessResult> {
  const { adapter, scan } = await runScanInternal();
  return {
    ok: true,
    platform: adapter?.id,
    adapter_present: !!adapter,
    scan,
  };
}

async function runInject(text = TEST_INJECT_TEXT): Promise<HarnessResult> {
  const { adapter, scan } = await runScanInternal();
  if (!adapter) return { ok: false, reason: 'no_adapter', scan };
  const inject = await runInjectInternal(adapter, text);
  return { ok: true, platform: adapter.id, adapter_present: true, scan, inject };
}

async function captureBundle(opts: { text?: string; notes?: string; captureDom?: boolean } = {}): Promise<HarnessResult> {
  const { adapter, scan } = await runScanInternal();
  if (!adapter) {
    return { ok: false, reason: 'no_adapter_for_current_url', scan };
  }
  const inject = await runInjectInternal(adapter, opts.text || TEST_INJECT_TEXT);
  const screenshot_data_url = await captureScreenshotViaExtension();
  const bundle = {
    platform: adapter.id,
    url: window.location.href,
    page_title: document.title,
    scan_result: scan,
    inject_result: { ...inject, attempted: true },
    screenshot_data_url,
    dom_snapshot: opts.captureDom ? domSnapshot() : null,
    notes: opts.notes || null,
  };
  const post = await apiPost('/api/capture-evidence', bundle);
  return {
    ok: post.ok,
    platform: adapter.id,
    adapter_present: true,
    scan,
    inject,
    evidence_id: post.json?.evidence_id,
    view_url: post.json?.admin_view_url,
    server_error: post.ok ? undefined : `HTTP ${post.status}: ${post.text}`,
  };
}

async function dealerKit(notes?: string): Promise<HarnessResult> {
  // Same as captureBundle but always includes DOM snapshot — that's
  // what I need to author real selectors when the adapter's guesses
  // miss on live dealer inboxes.
  return captureBundle({ notes, captureDom: true });
}

async function overdriveSmoke(): Promise<HarnessResult> {
  // Overdrive-specific: run the detector for 8s, then trigger a
  // synthetic autonomous cycle via the existing OVERDRIVE_INJECT_TEXT
  // path with a canned reply. Verifies detector + inject + kill
  // switch in one shot.
  try {
    // Ask background for the current controller status.
    const status: any = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'OVERDRIVE_CONTROLLER_STATUS' }, resolve);
    });
    // Try an inject through OVERDRIVE_INJECT_TEXT (the same path
    // orchestrateReply uses).
    const inject: any = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'OVERDRIVE_INJECT_TEXT', payload: { text: '[overdrive smoke] verification cycle' } },
        (r) => resolve(r || { ok: false })
      );
    });
    return {
      ok: true,
      platform: 'facebook',
      adapter_present: true,
      scan: { controller_status: status, overdrive_inject_result: inject },
    };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'overdrive_smoke_failed' };
  }
}

export function installVerificationHarness(): void {
  if (typeof window === 'undefined') return;
  const api = {
    runScan,
    runInject,
    captureBundle,
    dealerKit,
    overdriveSmoke,
    /** Quick help. */
    help: () => `Brevmont Universal Capture verification harness

  await __brevmontVerify.runScan()              — SCAN_LEAD_V2 on current tab
  await __brevmontVerify.runInject("hello")     — scan + inject + verify
  await __brevmontVerify.captureBundle()        — full bundle → server
  await __brevmontVerify.dealerKit(notes)       — bundle + DOM snapshot
  await __brevmontVerify.overdriveSmoke()       — Overdrive controller + inject cycle
`,
  };
  (window as any).__brevmontVerify = api;

  if (!(window as any).__brevmontVerifyBridgeInstalled) {
    (window as any).__brevmontVerifyBridgeInstalled = true;
    window.addEventListener('message', async (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data || {};
      if (data?.source !== PAGE_REQUEST_SOURCE) return;
      const requestId = data.requestId;
      const method = String(data.method || '');
      const args = Array.isArray(data.args) ? data.args : [];
      try {
        const fn = (api as any)[method];
        if (typeof fn !== 'function') throw new Error(`unknown_verify_method:${method}`);
        const result = await fn(...args);
        window.postMessage({ source: CONTENT_RESPONSE_SOURCE, requestId, ok: true, result }, '*');
      } catch (err: any) {
        window.postMessage({
          source: CONTENT_RESPONSE_SOURCE,
          requestId,
          ok: false,
          error: err?.message || String(err || 'verify_bridge_failed'),
        }, '*');
      }
    });
  }
  // eslint-disable-next-line no-console
  console.log('[brevmont] verification harness installed. Try __brevmontVerify.help()');
}
