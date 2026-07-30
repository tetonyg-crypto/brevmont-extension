/**
 * Universal Capture — forensic evidence bundle.
 *
 * Extracted from verificationHarness.ts (2026-07-26) so the production content
 * script can import captureBundle() for adapter-scan-failure diagnostics WITHOUT
 * pulling in the DevTools debug harness (installVerificationHarness /
 * window.__brevmontVerify). Those page-callable hooks must never ship in the
 * store build; keeping them in a separate module lets tree-shaking drop them.
 */

import type { PlatformAdapter } from './types';
import { resolveAdapter } from './registry';
import { pickCleanName, verifyInject } from './shared';

export interface HarnessResult {
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

export const TEST_INJECT_TEXT = '[brevmont verify — safe to delete]';

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

export async function apiPost(path: string, body: unknown): Promise<{ ok: boolean; status: number; json?: any; text?: string }> {
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

export async function captureScreenshotViaExtension(): Promise<string | null> {
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

export function domSnapshot(): string {
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

export async function runScanInternal(): Promise<{ adapter: PlatformAdapter | null; scan: any }> {
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

export async function runInjectInternal(adapter: PlatformAdapter, text: string) {
  const plan = await adapter.inject(text, adapter.capabilities.default_output);
  if (!plan.ok || !plan.composer_selector) {
    return { ok: false, reason: plan.reason || 'no_composer', method: plan.method };
  }
  const composer = document.querySelector(plan.composer_selector.split(' >>> ')[0]) as HTMLElement | null;
  if (!composer) {
    return { ok: false, reason: 'composer_selector_resolved_null', selector: plan.composer_selector };
  }
  const injectRes: any = await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'INJECT_CONTENT_V2', payload: { text, kind: adapter.capabilities.default_output } },
      (r) => resolve(r || { ok: false, reason: 'runtime_no_response' })
    );
  });
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

export async function captureBundle(opts: { text?: string; notes?: string; captureDom?: boolean } = {}): Promise<HarnessResult> {
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
