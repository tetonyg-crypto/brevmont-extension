/**
 * Overdrive shared types.
 */

export type OverdriveStage =
  | 'inquiry'
  | 'qualifying'
  | 'objection'
  | 'appointment_drive'
  | 'appointment_set'
  | 'escalated'
  | 'dead';

export interface OverdriveThreadContext {
  /** Rep-scoped stable ID for this Messenger conversation. */
  conversation_key: string;
  /** SHA-256 of the last inbound message text — idempotency anchor. */
  last_inbound_hash: string;
  last_inbound_text: string;
  thread_history: string[];
  listing?: {
    title?: string | null;
    url?: string | null;
    year?: number | null;
    make?: string | null;
    model?: string | null;
  } | null;
  stage_hint?: OverdriveStage | null;
}

export interface OverdriveSendResult {
  ok: boolean;
  method: 'enter_key' | 'button_click' | 'react_fiber' | 'not_attempted';
  verified: boolean;
  latency_ms: number;
  error?: string;
  attempts: Array<{ method: string; ok: boolean; error?: string }>;
}

export interface OverdriveAttachResult {
  ok: boolean;
  method: 'clipboard_paste' | 'file_input' | 'drop_event' | 'not_attempted';
  latency_ms: number;
  error?: string;
  attempts: Array<{ method: string; ok: boolean; error?: string }>;
}

export interface DetectionSignal {
  type: 'mutation_conversation_list' | 'mutation_active_thread' | 'title_unread_count' | 'alarm_keepalive';
  detected_at: number;
  conversation_hint?: string;
  raw?: string;
}

export type DetectionCallback = (signal: DetectionSignal) => void;
