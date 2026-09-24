/**
 * WhatsApp Web message text — pure, DOM-free normalization and
 * classification helpers for the WhatsApp adapter
 * (entrypoints/lib/platforms/whatsapp.ts).
 *
 * Mirrors instagramMessageText.ts / xMessageText.ts's split: noise-
 * filtering and rich-content-placeholder rules live here, unit-testable
 * without a browser page, so a future WhatsApp DOM fix touches
 * whatsapp.ts (DOM) or this file (text rules) — never both at once.
 *
 * FRAGILE ASSUMPTIONS — UNVERIFIED AGAINST LIVE web.whatsapp.com. This
 * sandbox cannot load real WhatsApp Web. Every rule below is reasoned
 * from documented/known WhatsApp Web conventions and the exact strings
 * Yancy reported seeing during a live test (2026-09-23), not confirmed
 * live DOM. Treat every regex here as a first guess that may need a
 * live-debugging pass, the same way instagram.ts's `<header>` assumption
 * and x.ts's `DmScroller`/contenteditable-composer assumptions did.
 *
 * CONFIRMED FROM THE LIVE TEST (2026-09-23, reported by Yancy, not
 * DevTools-verified): these exact system-banner strings appeared in the
 * conversation pane and are NOT messages:
 *   - "Message notifications are off."
 *   - "The sender won't see if you read their messages until you
 *      reply or add them as a contact."
 *   - "Block"
 *   - "Add to contacts"
 * These are treated as HIGH-CONFIDENCE exclusions (real observed
 * strings, not guesses). Everything else below (typing indicators,
 * read receipts, reaction copy, rich-content placeholders) is a
 * first-guess pattern in the same spirit as Instagram/X's noise lists.
 */

export type WhatsAppMessageContentType =
  | 'text'
  | 'reply_quote'
  | 'image'
  | 'video'
  | 'voice'
  | 'document'
  | 'sticker'
  | 'gif'
  | 'location'
  | 'contact_card'
  | 'deleted'
  | 'unknown_rich';

export interface WhatsAppBubbleSignal {
  /** Raw innerText of the candidate message row. */
  text: string;
  hasImage?: boolean;
  hasVideo?: boolean;
  hasAudio?: boolean;
  hasDocument?: boolean;
  isSticker?: boolean;
  isGif?: boolean;
  hasLocation?: boolean;
  hasContactCard?: boolean;
  /** Quoted/replied-to text, if a reply-preview block is present in the row. */
  quotedText?: string | null;
}

export interface WhatsAppClassifiedMessage {
  text: string;
  contentType: WhatsAppMessageContentType;
}

export function normalizeWhatsAppText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when `value` is WhatsApp Web UI chrome / system banner / presence /
 * receipt / reaction noise — never a real message body. Callers must drop
 * these rows entirely rather than treating them as customer or rep speech.
 *
 * The first four checks are the CONFIRMED-live exact banner strings from
 * the 2026-09-23 test (section 9 of the founder spec). The rest are
 * first-guess patterns for common WhatsApp Web chrome, unverified.
 */
export function isWhatsAppNoiseText(value: unknown): boolean {
  const text = normalizeWhatsAppText(value);
  if (!text) return true;

  // CONFIRMED LIVE (2026-09-23) — exact strings observed in the test.
  if (/^message notifications are off\.?$/i.test(text)) return true;
  if (/^the sender won.?t see if you read their messages until you reply or add them as a contact\.?$/i.test(text)) return true;
  if (/^block$/i.test(text)) return true;
  if (/^add to contacts?$/i.test(text)) return true;

  // Other known WhatsApp Web system/chrome copy — UNVERIFIED, first guess.
  if (/^messages? and calls are end-to-end encrypted\b/i.test(text)) return true;
  if (/^you.?re now an admin$/i.test(text)) return true;
  if (/^get whatsapp for (?:mac|windows)\b/i.test(text)) return true;
  if (/^\d+\s+unread\s+messages?$/i.test(text)) return true;
  if (/^encryption\b/i.test(text)) return true;
  if (/^tap to (?:learn more|change)\b/i.test(text)) return true;

  // Presence / typing chrome ("online", "typing…", "<name> is typing…").
  if (/^(?:online|typing(?:\.{1,3}|…)?)$/i.test(text)) return true;
  if (/^(?:.{1,60}\s+)?is\s+typing(?:\.{1,3}|…)?$/i.test(text)) return true;
  if (/^last seen\b/i.test(text)) return true;

  // Read-receipt / delivery labels rendered as their own row.
  if (/^(seen|delivered|sent|read)$/i.test(text)) return true;

  // Reaction sentences — never a message body, always metadata about one.
  if (/^reacted\s+.{1,8}\s+to\s+(?:this|your\s+message)$/i.test(text)) return true;
  if (/^you\s+reacted\s+.{1,8}\s+to\s+.{1,60}$/i.test(text)) return true;

  // Bare timestamps / date dividers rendered as their own row.
  if (/^\d{1,2}:\d{2}\s*(?:am|pm)?$/i.test(text)) return true;
  if (/^(?:today|yesterday|mon|tue|wed|thu|fri|sat|sun)[a-z]*(?:,\s*\S.*)?$/i.test(text) && text.length < 24) return true;
  if (/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?$/i.test(text)) return true;

  // Group system events. Deliberately scoped to the specific phrases
  // WhatsApp Web renders for these ("X created this group", "X changed
  // the subject to Y") rather than bare words like "added"/"removed"/
  // "left" — those are common English words a real message can contain
  // ("I left my phone there", "removed from the list") and a bare-word
  // match would wrongly discard real sales conversation text.
  if (/\bcreated (?:this )?group\b/i.test(text) && text.length < 160) return true;
  if (/\bchanged the subject\b/i.test(text) && text.length < 160) return true;
  if (/\bchanged this group.?s icon\b/i.test(text) && text.length < 160) return true;
  if (/\bchanged the group description\b/i.test(text) && text.length < 160) return true;
  // "<Name> added <Name>" / "<Name> removed <Name>" / "<Name> left" as
  // the ENTIRE message (start-to-end, short) — the shape WhatsApp Web
  // renders these system rows in, never a substring match.
  if (/^\S+\s+(?:added|removed)\s+\S+$/i.test(text) && text.length < 80) return true;
  if (/^\S+\s+left$/i.test(text) && text.length < 40) return true;
  if (/^you\s+(?:added|removed)\s+\S+/i.test(text) && text.length < 80) return true;

  return false;
}

/**
 * Classify a single message row's content. V1 needs reliable plain
 * text; rich content (images, video, voice notes, documents, stickers,
 * GIFs, location/contact cards, deleted messages) is represented as a
 * bracketed, non-hallucinated placeholder so Lead Responder generation
 * still has a true signal ("customer sent a photo") instead of silently
 * losing the turn or inventing text that was never said.
 *
 * Reply/quoted-message context is preserved as a `[replying to: "..."]`
 * prefix on the reply's own text (spec section 11) rather than a nested
 * structure.
 */
export function classifyWhatsAppBubble(signal: WhatsAppBubbleSignal): WhatsAppClassifiedMessage {
  let text = normalizeWhatsAppText(signal.text);

  if (/\bthis message was deleted\b/i.test(text) || /^this message was deleted$/i.test(text)) {
    return { text: '[deleted message]', contentType: 'deleted' };
  }

  let contentType: WhatsAppMessageContentType = 'text';
  if (!text && signal.isSticker) { text = '[sticker]'; contentType = 'sticker'; }
  else if (!text && signal.isGif) { text = '[GIF]'; contentType = 'gif'; }
  else if (!text && signal.hasAudio) { text = '[voice note]'; contentType = 'voice'; }
  else if (!text && signal.hasVideo) { text = '[video]'; contentType = 'video'; }
  else if (!text && signal.hasDocument) { text = '[document]'; contentType = 'document'; }
  else if (!text && signal.hasLocation) { text = '[location]'; contentType = 'location'; }
  else if (!text && signal.hasContactCard) { text = '[contact card]'; contentType = 'contact_card'; }
  else if (!text && signal.hasImage) { text = '[image]'; contentType = 'image'; }
  else if (!text) {
    return { text: '', contentType: 'unknown_rich' };
  }

  const quoted = normalizeWhatsAppText(signal.quotedText || '');
  if (quoted) {
    const trimmedQuote = quoted.length > 120 ? `${quoted.slice(0, 117)}...` : quoted;
    return { text: `[replying to: "${trimmedQuote}"] ${text}`.trim(), contentType: contentType === 'text' ? 'reply_quote' : contentType };
  }

  return { text, contentType };
}
