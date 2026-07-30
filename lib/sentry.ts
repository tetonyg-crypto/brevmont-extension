/**
 * Sentry for MV3 service worker — init once; strip PII in beforeSend.
 */

import * as Sentry from '@sentry/browser';
import { redactText, redactObject } from './redact';

let sentryReady = false;

function readSentryDsn(): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return (env?.WXT_SENTRY_DSN || env?.SENTRY_DSN || '').trim();
  } catch {
    return '';
  }
}

export function initSentry(): void {
  if (sentryReady) return;
  const dsn = readSentryDsn();
  if (!dsn) return;
  try {
    Sentry.init({
      dsn,
      environment: import.meta.env?.MODE || 'production',
      release: browser.runtime.getManifest().version,
      maxBreadcrumbs: 20,
      sampleRate: 1.0,
      tracesSampleRate: 0,
      beforeSend(event) {
        if (event.request?.data) {
          event.request.data = '[REDACTED]';
        }
        // Breadcrumbs and extras carry rep-typed free text (e.g. Command-Mode
        // input can contain a customer name + phone). Scrub them through the
        // same PII redaction the support-ticket path uses before anything
        // leaves the device.
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs.map((b) => ({
            ...b,
            message: b.message ? redactText(b.message) : b.message,
            data: b.data ? redactObject(b.data) : b.data,
          }));
        }
        if (event.extra) {
          event.extra = redactObject(event.extra);
        }
        return event;
      },
    });
    sentryReady = true;
  } catch {
    /* noop */
  }
}

export function setSentryContext(dealershipId: string, repName: string): void {
  if (!sentryReady) return;
  try {
    Sentry.setTag('dealership_id', dealershipId);
    Sentry.setTag('rep_name', repName);
    Sentry.setTag('extension_version', browser.runtime.getManifest().version);
  } catch {
    /* noop */
  }
}

export function captureError(error: Error, context?: Record<string, unknown>): void {
  try {
    if (sentryReady) {
      if (context) {
        Sentry.withScope((scope) => {
          Object.entries(context).forEach(([key, value]) => {
            scope.setExtra(key, value);
          });
          Sentry.captureException(error);
        });
      } else {
        Sentry.captureException(error);
      }
    }
  } catch {
    /* noop */
  }
  void browser.storage.local.set({
    brevmont_last_error: error.message,
    brevmont_last_error_at: new Date().toISOString(),
  });
  void browser.storage.local.get(['brevmont_recent_errors']).then((r) => {
    const prev = Array.isArray(r.brevmont_recent_errors) ? (r.brevmont_recent_errors as string[]) : [];
    const next = [error.message, ...prev].filter(Boolean).slice(0, 5);
    return browser.storage.local.set({ brevmont_recent_errors: next });
  }).catch(() => {});
}

export function addBreadcrumb(category: string, message: string, data?: Record<string, unknown>): void {
  if (!sentryReady) return;
  try {
    Sentry.addBreadcrumb({
      category,
      message,
      data,
      level: 'info',
    });
  } catch {
    /* noop */
  }
}
