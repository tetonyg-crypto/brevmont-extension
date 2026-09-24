/**
 * X (x.com) DM message text — pure, DOM-free normalization and
 * classification helpers for the X adapter
 * (entrypoints/lib/platforms/x.ts).
 *
 * Mirrors instagramMessageText.ts's split: noise-filtering and
 * rich-content-placeholder rules live here, unit-testable without a
 * browser page, so a future X DOM fix touches x.ts (DOM) or this file
 * (text rules) — never both at once.
 *
 * FRAGILE ASSUMPTIONS — UNVERIFIED AGAINST LIVE X (2026-09-23). This
 * repo has no way to load real x.com in this environment. Every rule
 * below is reasoned from documented/known X web-app conventions, not
 * confirmed live DOM. Treat every regex here as a first guess that
 * may need a live-debugging pass, the same way instagram.ts's
 * `<header>` assumption did on 2026-09-23:
 *  - Presence/typing copy ("X is typing...") — X's web client is
 *    known to show a typing indicator in DM threads, but the exact
 *    wording is not confirmed here.
 *  - Read-receipt copy ("Seen") — X DMs show a "Seen" indicator;
 *    exact casing/placement unconfirmed.
 *  - "X reacted ... to this" — X supports emoji reactions on DMs;
 *    the exact sentence X renders is unconfirmed (based on the
 *    general shape other chat apps use, mirrored from Instagram's
 *    own unconfirmed-until-tested reaction string).
 *  - Shared post/tweet links use x.com/twitter.com status URL shape
 *    (`/status/`), which IS a stable, long-documented URL convention
 *    (very low risk).
 *  - "Unsent"/deleted-message copy is unconfirmed for X DMs.
 */

export type XMessageContentType =
  | 'text'
  | 'shared_post'
  | 'photo'
  | 'video'
  | 'gif'
  | 'voice'
  | 'unsent'
  | 'unknown_rich';

export interface XBubbleSignal {
  /** Raw innerText of the candidate message row. */
  text: string;
  hasImage?: boolean;
  hasVideo?: boolean;
  hasAudio?: boolean;
  /** True when the row is recognizably an animated GIF (X labels/serves
   *  GIFs distinctly from ordinary video in its DM attachments). */
  isGif?: boolean;
  /** href of an in-row anchor pointing at a post/tweet permalink, if any. */
  postHref?: string | null;
}

export interface XClassifiedMessage {
  text: string;
  contentType: XMessageContentType;
}

export function normalizeXText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when `value` is UI chrome / presence / receipt / reaction noise
 * X renders inline with the message list — never a real message body.
 * Callers must drop these rows entirely rather than treating them as
 * customer or rep speech.
 *
 * FRAGILE — see module header. None of these exact strings are
 * confirmed against a live X DM thread.
 */
export function isXNoiseText(value: unknown): boolean {
  const text = normalizeXText(value);
  if (!text) return true;

  // Presence / typing chrome ("Typing...", "<name> is typing...").
  if (/^(?:.{1,60}\s+)?is\s+typing(?:\.{1,3}|…)?$/i.test(text)) return true;

  // Read-receipt labels rendered as their own row.
  if (/^(seen|delivered|sent)$/i.test(text)) return true;
  if (/^seen\s+by\s+.{1,60}$/i.test(text)) return true;
  if (/^seen\s+\d{1,2}:\d{2}\s*(?:am|pm)?$/i.test(text)) return true;

  // Reaction sentences — never a message body, always metadata about one.
  if (/^reacted\s+.{1,8}\s+to\s+(?:this|your\s+message)$/i.test(text)) return true;
  if (/^you\s+reacted\s+.{1,8}\s+to\s+.{1,60}$/i.test(text)) return true;

  // Bare timestamps / date dividers rendered as their own row.
  if (/^\d{1,2}:\d{2}\s*(?:am|pm)?$/i.test(text)) return true;
  if (/^(?:yesterday|today|mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+\d{1,2}:\d{2}\s*(?:am|pm)?$/i.test(text)) return true;
  if (/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?$/i.test(text)) return true;

  return false;
}

/**
 * Classify a single message row's content. V1 needs reliable plain
 * text; rich content (shared posts, photos, video, GIF, voice, unsent)
 * is represented as a bracketed, non-hallucinated placeholder so Lead
 * Responder generation still has a true signal ("customer sent a
 * photo") instead of silently losing the turn or inventing text that
 * was never said.
 */
export function classifyXBubble(signal: XBubbleSignal): XClassifiedMessage {
  const text = normalizeXText(signal.text);

  if (
    /\b(?:unsent|deleted)\s+(?:a\s+)?message\b/i.test(text) ||
    /\bmessage\s+(?:was\s+)?(?:unsent|deleted|removed)\b/i.test(text) ||
    /^this\s+message\s+(?:was\s+)?(?:unsent|deleted|removed)\b/i.test(text)
  ) {
    return { text: '[deleted message]', contentType: 'unsent' };
  }

  const href = String(signal.postHref || '');
  // X/Twitter permalink shape: /<username>/status/<id>. This is the one
  // structural assumption in this file with real confidence — it has
  // been X/Twitter's stable URL convention for over a decade.
  if (href && /\/status\/\d+/i.test(href)) {
    return { text: text || '[shared a post]', contentType: 'shared_post' };
  }

  if (signal.hasAudio) {
    return { text: '[voice message]', contentType: 'voice' };
  }

  // Media-only rows (no caption text) — do not hallucinate a caption.
  if (!text && signal.isGif) return { text: '[GIF]', contentType: 'gif' };
  if (!text && signal.hasVideo) return { text: '[shared a video]', contentType: 'video' };
  if (!text && signal.hasImage) return { text: '[shared a photo]', contentType: 'photo' };

  if (!text) return { text: '', contentType: 'unknown_rich' };

  return { text, contentType: 'text' };
}
