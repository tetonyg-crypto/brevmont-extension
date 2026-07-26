import type { OverdriveSendResult } from './types';

// ═══ ASSIST MODE — no programmatic send to Facebook (2026-07-25) ═════════════
// Overdrive never sends. The orchestrator pre-fills the draft into the Messenger
// composer and stops; the rep taps Facebook's own send button (a genuine
// isTrusted user gesture). The former autonomous-send machinery — synthesized
// keypress, synthetic click, and React-fiber onClick isTrusted-bypass — has been
// physically removed from the bundle. This stub only exists so any legacy caller
// gets a clean no-op result; there is NO code path that programmatically submits
// a message to a third-party site.
export async function overdriveSend(_sentText: string): Promise<OverdriveSendResult> {
  return {
    ok: false,
    method: 'assist_mode_no_send',
    verified: false,
    latency_ms: 0,
    error: 'programmatic_send_disabled_assist_mode',
    attempts: [],
  };
}
