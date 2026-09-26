/**
 * Instagram DM message text — pure, DOM-free normalization and
 * classification helpers for the Instagram adapter
 * (entrypoints/lib/platforms/instagram.ts).
 *
 * Split out (mirrors messengerSystemText.ts / facebookTranscript.ts)
 * so the noise-filtering and rich-content-placeholder rules can be
 * unit tested without spinning up a browser page, and so a future
 * Instagram DOM fix touches this file, not a page-scanning one.
 *
 * FRAGILE ASSUMPTIONS (documented per spec — Instagram/Meta markup
 * changes without notice, so keep these narrow and isolated here):
 *  - Read-receipt / presence rows ("Active now", "Seen", "Typing…")
 *    are recognized by their EXACT visible text, not a CSS class.
 *    If Meta rewords these strings, isInstagramNoiseText() needs an
 *    update — nothing outside this file.
 *  - Reaction rows are recognized by the sentence Instagram renders
 *    for them ("Reacted ❤️ to your message"), not by a DOM attribute,
 *    because IG does not expose a stable role/aria-label for reactions.
 *  - "Shared a post/reel" detection depends on an anchor whose href
 *    contains "/p/" (feed post) or "/reel/" (Reels) — these are
 *    Instagram's own stable permalink path prefixes, not a class name.
 */

export type InstagramMessageContentType =
  | 'text'
  | 'shared_post'
  | 'shared_reel'
  | 'photo'
  | 'video'
  | 'voice'
  | 'unsent'
  | 'unknown_rich';

export interface InstagramBubbleSignal {
  /** Raw innerText of the candidate message row. */
  text: string;
  /** Row contains an <img> (avatar-only rows are filtered upstream by the caller). */
  hasImage?: boolean;
  /** Row contains a <video> element. */
  hasVideo?: boolean;
  /** Row contains an <audio> element (voice message playback). */
  hasAudio?: boolean;
  /** href of an in-row anchor pointing at a post/reel permalink, if any. */
  postHref?: string | null;
}

export interface InstagramClassifiedMessage {
  text: string;
  contentType: InstagramMessageContentType;
}

export interface HorizontalBox {
  left: number;
  width: number;
}

/**
 * Sender side of a message row, measured against the THREAD column (the
 * composer's box), never against `[role="main"]`: on instagram.com/direct,
 * `[role="main"]` spans the inbox list AND the thread, so its midpoint sits
 * inside the inbox list and every thread bubble read as "outbound".
 * Confirmed live 2026-09-25: Gaaabby<3's own messages were sent to the model
 * as `[outbound]` and the rep's own message became "LAST CUSTOMER MESSAGE".
 *
 * Returns 'outside' for rows left of the thread column (inbox previews),
 * which callers must drop.
 */
export function instagramBubbleSide(
  bubble: HorizontalBox,
  pane: HorizontalBox,
): 'inbound' | 'outbound' | 'unknown' | 'outside' {
  if (!(pane.width > 0) || !(bubble.width > 0)) return 'unknown';
  if (bubble.left + bubble.width <= pane.left) return 'outside';
  if (bubble.width >= pane.width * 0.9) return 'unknown';
  const mid = pane.left + pane.width / 2;
  return bubble.left + bubble.width / 2 > mid ? 'outbound' : 'inbound';
}

export function normalizeInstagramText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when `value` is UI chrome / presence / receipt / reaction noise
 * that Instagram renders inline with the message list — never a real
 * message body. Callers must drop these rows entirely rather than
 * treating them as customer or rep speech.
 */
export function isInstagramNoiseText(value: unknown): boolean {
  const text = normalizeInstagramText(value);
  if (!text) return true;

  // Presence / typing chrome ("Active now", "Active 3h ago", "Cardog is typing…").
  if (/^active\s+(now|\d+\s*[a-z]+\s+ago)$/i.test(text)) return true;
  if (/^(?:.{1,60}\s+)?is\s+typing(?:\.{1,3}|…)?$/i.test(text)) return true;

  // Read-receipt labels that show up as their own row/line.
  if (/^(seen|delivered|sent)$/i.test(text)) return true;
  if (/^seen\s+by\s+.{1,60}$/i.test(text)) return true;

  // Reaction sentences — never a message body, always metadata about one.
  if (/^reacted\s+.{1,8}\s+to\s+your\s+message$/i.test(text)) return true;
  if (/^you\s+reacted\s+.{1,8}\s+to\s+.{1,60}$/i.test(text)) return true;

  // Bare timestamps rendered as their own row between message groups
  // ("2:41 PM", "Yesterday 9:14 AM", "Mon 11:02 AM").
  if (/^\d{1,2}:\d{2}\s*(?:am|pm)?$/i.test(text)) return true;
  if (/^(?:yesterday|today|mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+\d{1,2}:\d{2}\s*(?:am|pm)?$/i.test(text)) return true;

  return false;
}

/**
 * Classify a single message row's content. V1 needs reliable plain
 * text; rich content (shared posts/reels, photos, video, voice,
 * unsent) is represented as a bracketed, non-hallucinated placeholder
 * so Lead Responder generation still has a true signal ("customer
 * sent a photo") instead of silently losing the turn or inventing
 * text that was never said.
 */
export function classifyInstagramBubble(signal: InstagramBubbleSignal): InstagramClassifiedMessage {
  const text = normalizeInstagramText(signal.text);

  if (/\bunsent\s+a\s+message\b/i.test(text)) {
    return { text: '[unsent message]', contentType: 'unsent' };
  }

  const href = String(signal.postHref || '');
  if (href) {
    if (/\/reels?\//i.test(href)) return { text: text || '[shared a reel]', contentType: 'shared_reel' };
    if (/\/p\//i.test(href)) return { text: text || '[shared a post]', contentType: 'shared_post' };
  }

  if (signal.hasAudio) {
    return { text: '[voice message]', contentType: 'voice' };
  }

  // Media-only rows (no caption text) — do not hallucinate a caption.
  if (!text && signal.hasVideo) return { text: '[shared a video]', contentType: 'video' };
  if (!text && signal.hasImage) return { text: '[shared a photo]', contentType: 'photo' };

  if (!text) return { text: '', contentType: 'unknown_rich' };

  return { text, contentType: 'text' };
}
