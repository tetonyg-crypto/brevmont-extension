import { describe, expect, it } from 'vitest';
import {
  classifyInstagramBubble,
  isInstagramNoiseText,
  normalizeInstagramText,
} from '../../entrypoints/lib/instagramMessageText';

describe('normalizeInstagramText', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeInstagramText('  Hey   there\n\nfriend  ')).toBe('Hey there friend');
  });
  it('handles non-string input safely', () => {
    expect(normalizeInstagramText(null)).toBe('');
    expect(normalizeInstagramText(undefined)).toBe('');
  });
});

describe('isInstagramNoiseText', () => {
  it('rejects presence/typing chrome', () => {
    expect(isInstagramNoiseText('Active now')).toBe(true);
    expect(isInstagramNoiseText('Active 3h ago')).toBe(true);
    expect(isInstagramNoiseText('Cardog is typing…')).toBe(true);
    expect(isInstagramNoiseText('is typing...')).toBe(true);
  });

  it('rejects read-receipt labels', () => {
    expect(isInstagramNoiseText('Seen')).toBe(true);
    expect(isInstagramNoiseText('Delivered')).toBe(true);
    expect(isInstagramNoiseText('Seen by cardog_official')).toBe(true);
  });

  it('rejects reaction sentences', () => {
    expect(isInstagramNoiseText('Reacted ❤️ to your message')).toBe(true);
    expect(isInstagramNoiseText('You reacted 😂 to Is the Tahoe still available')).toBe(true);
  });

  it('rejects bare timestamp rows', () => {
    expect(isInstagramNoiseText('2:41 PM')).toBe(true);
    expect(isInstagramNoiseText('Yesterday 9:14 AM')).toBe(true);
  });

  it('rejects empty/whitespace-only text', () => {
    expect(isInstagramNoiseText('')).toBe(true);
    expect(isInstagramNoiseText('   ')).toBe(true);
  });

  it('accepts real sales-conversation text', () => {
    expect(isInstagramNoiseText('Is the 2021 Tahoe still available?')).toBe(false);
    expect(isInstagramNoiseText('yes! 🔥 can you send pics')).toBe(false);
    expect(isInstagramNoiseText('check this out https://example.com/listing')).toBe(false);
  });
});

describe('classifyInstagramBubble', () => {
  it('passes plain text through unchanged', () => {
    expect(classifyInstagramBubble({ text: 'Is the Tahoe still available?' })).toEqual({
      text: 'Is the Tahoe still available?',
      contentType: 'text',
    });
  });

  it('preserves emoji in plain text', () => {
    expect(classifyInstagramBubble({ text: 'yes!! 🔥🔥 so hyped' })).toEqual({
      text: 'yes!! 🔥🔥 so hyped',
      contentType: 'text',
    });
  });

  it('keeps a link as normal text (V1 does not need a link placeholder)', () => {
    const result = classifyInstagramBubble({ text: 'check the listing https://dealer.example.com/inv/123' });
    expect(result.contentType).toBe('text');
    expect(result.text).toContain('https://dealer.example.com/inv/123');
  });

  it('flags an unsent message without inventing content', () => {
    expect(classifyInstagramBubble({ text: 'You unsent a message' })).toEqual({
      text: '[unsent message]',
      contentType: 'unsent',
    });
  });

  it('labels a shared post permalink as a typed placeholder', () => {
    expect(classifyInstagramBubble({ text: '', postHref: '/p/Cabc123XY/' })).toEqual({
      text: '[shared a post]',
      contentType: 'shared_post',
    });
  });

  it('labels a shared reel permalink as a typed placeholder', () => {
    expect(classifyInstagramBubble({ text: '', postHref: '/reel/Cxyz456AB/' })).toEqual({
      text: '[shared a reel]',
      contentType: 'shared_reel',
    });
  });

  it('keeps a caption when a shared post also has text', () => {
    expect(classifyInstagramBubble({ text: 'check this out', postHref: '/p/Cabc123XY/' })).toEqual({
      text: 'check this out',
      contentType: 'shared_post',
    });
  });

  it('labels a voice message without transcribing it', () => {
    expect(classifyInstagramBubble({ text: '', hasAudio: true })).toEqual({
      text: '[voice message]',
      contentType: 'voice',
    });
  });

  it('labels an image-only bubble without hallucinating a caption', () => {
    expect(classifyInstagramBubble({ text: '', hasImage: true })).toEqual({
      text: '[shared a photo]',
      contentType: 'photo',
    });
  });

  it('labels a video-only bubble without hallucinating a caption', () => {
    expect(classifyInstagramBubble({ text: '', hasVideo: true })).toEqual({
      text: '[shared a video]',
      contentType: 'video',
    });
  });

  it('returns unknown_rich (empty text) rather than guessing when nothing is legible', () => {
    expect(classifyInstagramBubble({ text: '' })).toEqual({ text: '', contentType: 'unknown_rich' });
  });
});
