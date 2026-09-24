import { describe, expect, it } from 'vitest';
import {
  classifyWhatsAppBubble,
  isWhatsAppNoiseText,
  normalizeWhatsAppText,
} from '../../entrypoints/lib/whatsappMessageText';

describe('normalizeWhatsAppText', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeWhatsAppText('  Hey   there\n\nfriend  ')).toBe('Hey there friend');
  });
  it('handles non-string input safely', () => {
    expect(normalizeWhatsAppText(null)).toBe('');
    expect(normalizeWhatsAppText(undefined)).toBe('');
  });
});

describe('isWhatsAppNoiseText', () => {
  it('rejects the CONFIRMED-live system banner strings (2026-09-23 test)', () => {
    expect(isWhatsAppNoiseText('Message notifications are off.')).toBe(true);
    expect(
      isWhatsAppNoiseText(
        "The sender won't see if you read their messages until you reply or add them as a contact.",
      ),
    ).toBe(true);
    expect(isWhatsAppNoiseText('Block')).toBe(true);
    expect(isWhatsAppNoiseText('Add to contacts')).toBe(true);
    expect(isWhatsAppNoiseText('Add to contact')).toBe(true);
  });

  it('rejects presence/typing chrome', () => {
    expect(isWhatsAppNoiseText('online')).toBe(true);
    expect(isWhatsAppNoiseText('typing...')).toBe(true);
    expect(isWhatsAppNoiseText('Cardog is typing…')).toBe(true);
    expect(isWhatsAppNoiseText('last seen today at 9:14 AM')).toBe(true);
  });

  it('rejects read-receipt labels', () => {
    expect(isWhatsAppNoiseText('Seen')).toBe(true);
    expect(isWhatsAppNoiseText('Delivered')).toBe(true);
    expect(isWhatsAppNoiseText('Read')).toBe(true);
  });

  it('rejects reaction sentences', () => {
    expect(isWhatsAppNoiseText('Reacted ❤️ to this')).toBe(true);
    expect(isWhatsAppNoiseText('You reacted 😂 to Is the Tahoe still available')).toBe(true);
  });

  it('rejects bare timestamp rows', () => {
    expect(isWhatsAppNoiseText('2:41 PM')).toBe(true);
  });

  it('rejects other known system/chrome copy', () => {
    expect(isWhatsAppNoiseText('Messages and calls are end-to-end encrypted.')).toBe(true);
    expect(isWhatsAppNoiseText('Get WhatsApp for Mac')).toBe(true);
    expect(isWhatsAppNoiseText('3 unread messages')).toBe(true);
  });

  it('rejects group system events', () => {
    expect(isWhatsAppNoiseText('Alex created this group')).toBe(true);
    expect(isWhatsAppNoiseText('Jordan changed the subject to "Deals"')).toBe(true);
  });

  it('rejects empty/whitespace-only text', () => {
    expect(isWhatsAppNoiseText('')).toBe(true);
    expect(isWhatsAppNoiseText('   ')).toBe(true);
  });

  it('accepts real sales-conversation text', () => {
    expect(isWhatsAppNoiseText('Is the 2021 Tahoe still available?')).toBe(false);
    expect(isWhatsAppNoiseText('yes! 🔥 can you send pics')).toBe(false);
    expect(isWhatsAppNoiseText('check this out https://example.com/listing')).toBe(false);
    expect(isWhatsAppNoiseText('Add me to the list for the truck')).toBe(false);
  });
});

describe('classifyWhatsAppBubble', () => {
  it('passes plain text through unchanged', () => {
    expect(classifyWhatsAppBubble({ text: 'Is the Tahoe still available?' })).toEqual({
      text: 'Is the Tahoe still available?',
      contentType: 'text',
    });
  });

  it('preserves emoji in plain text', () => {
    expect(classifyWhatsAppBubble({ text: 'yes!! 🔥🔥 so hyped' })).toEqual({
      text: 'yes!! 🔥🔥 so hyped',
      contentType: 'text',
    });
  });

  it('keeps a link as normal text', () => {
    const result = classifyWhatsAppBubble({ text: 'check the listing https://dealer.example.com/inv/123' });
    expect(result.contentType).toBe('text');
    expect(result.text).toContain('https://dealer.example.com/inv/123');
  });

  it('flags a deleted message without inventing content', () => {
    expect(classifyWhatsAppBubble({ text: 'This message was deleted' })).toEqual({
      text: '[deleted message]',
      contentType: 'deleted',
    });
  });

  it('labels an image-only bubble without hallucinating a caption', () => {
    expect(classifyWhatsAppBubble({ text: '', hasImage: true })).toEqual({
      text: '[image]',
      contentType: 'image',
    });
  });

  it('labels a video-only bubble without hallucinating a caption', () => {
    expect(classifyWhatsAppBubble({ text: '', hasVideo: true })).toEqual({
      text: '[video]',
      contentType: 'video',
    });
  });

  it('labels a voice note without transcribing it', () => {
    expect(classifyWhatsAppBubble({ text: '', hasAudio: true })).toEqual({
      text: '[voice note]',
      contentType: 'voice',
    });
  });

  it('labels a document without inventing its filename/contents', () => {
    expect(classifyWhatsAppBubble({ text: '', hasDocument: true })).toEqual({
      text: '[document]',
      contentType: 'document',
    });
  });

  it('labels a sticker distinctly from an image', () => {
    expect(classifyWhatsAppBubble({ text: '', isSticker: true })).toEqual({
      text: '[sticker]',
      contentType: 'sticker',
    });
  });

  it('labels a GIF distinctly from a video', () => {
    expect(classifyWhatsAppBubble({ text: '', isGif: true })).toEqual({
      text: '[GIF]',
      contentType: 'gif',
    });
  });

  it('labels a shared location without inventing coordinates', () => {
    expect(classifyWhatsAppBubble({ text: '', hasLocation: true })).toEqual({
      text: '[location]',
      contentType: 'location',
    });
  });

  it('labels a shared contact card without inventing its details', () => {
    expect(classifyWhatsAppBubble({ text: '', hasContactCard: true })).toEqual({
      text: '[contact card]',
      contentType: 'contact_card',
    });
  });

  it('returns unknown_rich (empty text) rather than guessing when nothing is legible', () => {
    expect(classifyWhatsAppBubble({ text: '' })).toEqual({ text: '', contentType: 'unknown_rich' });
  });

  it('prefixes a reply with its quoted context instead of nesting structure', () => {
    expect(
      classifyWhatsAppBubble({ text: 'Yes still here!', quotedText: 'Is the Tahoe still available' }),
    ).toEqual({
      text: '[replying to: "Is the Tahoe still available"] Yes still here!',
      contentType: 'reply_quote',
    });
  });

  it('truncates a very long quoted context rather than ballooning the row', () => {
    const longQuote = 'a'.repeat(200);
    const result = classifyWhatsAppBubble({ text: 'ok', quotedText: longQuote });
    expect(result.text.startsWith('[replying to: "')).toBe(true);
    expect(result.text.length).toBeLessThan(longQuote.length + 40);
  });

  it('a reply to a rich-content quote still classifies the reply row itself as text', () => {
    const result = classifyWhatsAppBubble({ text: 'noted', quotedText: '[image]' });
    expect(result.text).toBe('[replying to: "[image]"] noted');
    expect(result.contentType).toBe('reply_quote');
  });
});
