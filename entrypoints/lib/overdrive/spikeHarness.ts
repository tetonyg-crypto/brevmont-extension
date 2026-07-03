/**
 * Overdrive Spike Harness — callable from the DevTools console on a
 * live Messenger tab to prove each spike in isolation.
 *
 * Usage (paste into console on messenger.com/facebook.com):
 *   await window.__overdriveSpike.sendText("test overdrive send")
 *   await window.__overdriveSpike.attachPhoto("data:image/jpeg;base64,...")
 *   window.__overdriveSpike.detectStart()
 *   // ... send yourself a message from another account ...
 *   window.__overdriveSpike.detectStop()
 *
 * The harness is only registered when the content script is running
 * in the Facebook top frame. Nothing here modifies feature code — it
 * only calls into the same modules Overdrive itself uses.
 */

import { overdriveSend } from './overdriveSend';
import { overdriveAttachPhoto } from './overdriveAttachPhoto';
import { install as detectorInstall, uninstall as detectorUninstall } from './overdriveDetector';
import type { DetectionSignal } from './types';

const detectionLog: DetectionSignal[] = [];

function installOn(target: any): void {
  if (!target) return;
  target.__overdriveSpike = {
    /**
     * Attempt an autonomous send with the given text. Requires that
     * `text` is already in the composer (call safeInjectText first
     * from the app, or paste it manually before invoking).
     */
    async sendText(text: string) {
      const started = performance.now();
      const result = await overdriveSend(text);
      const elapsedMs = Math.round(performance.now() - started);
      // eslint-disable-next-line no-console
      console.log('[overdrive-spike] send result:', {
        ...result,
        harness_elapsed_ms: elapsedMs,
      });
      return result;
    },

    /**
     * Attempt an image attach on the current composer with the given
     * data URL. Returns structured result.
     */
    async attachPhoto(dataUrl: string) {
      const started = performance.now();
      const result = await overdriveAttachPhoto(dataUrl);
      const elapsedMs = Math.round(performance.now() - started);
      // eslint-disable-next-line no-console
      console.log('[overdrive-spike] attach result:', {
        ...result,
        harness_elapsed_ms: elapsedMs,
      });
      return result;
    },

    /**
     * Start detection observers. Logs each signal to console and to
     * the in-memory detectionLog.
     */
    detectStart() {
      detectionLog.length = 0;
      detectorInstall((signal) => {
        detectionLog.push(signal);
        // eslint-disable-next-line no-console
        console.log('[overdrive-spike] detected:', signal);
      });
      // eslint-disable-next-line no-console
      console.log('[overdrive-spike] detection installed. Send yourself a message from another account.');
    },

    /**
     * Stop detection observers and return the log.
     */
    detectStop() {
      detectorUninstall();
      // eslint-disable-next-line no-console
      console.log(`[overdrive-spike] detection stopped. ${detectionLog.length} signals captured.`);
      return [...detectionLog];
    },

    /** Read-only snapshot of captured signals so far. */
    detectionLog: () => [...detectionLog],
  };

  // eslint-disable-next-line no-console
  console.log('[overdrive-spike] harness installed. window.__overdriveSpike is now available.');
}

/**
 * Called from content script initialization on Facebook / Messenger
 * frames. No-ops in non-Facebook contexts.
 */
export function installSpikeHarness(): void {
  if (typeof window === 'undefined') return;
  try {
    installOn(window);
  } catch {
    /* extension may run in restricted contexts */
  }
}
