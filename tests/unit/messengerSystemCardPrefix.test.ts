import { describe, expect, it } from 'vitest';
import { cleanMessengerMessageText, isMessengerSystemCardText } from '../../entrypoints/lib/messengerSystemText';

// Founder runtime defect 2026-09-25: a Facebook Marketplace system-card
// action log entry ("Enter, September 2, 2026, 6:17 PM by Haley: Haley sold
// 2023 Ford F150 Raptor.") leaked into the scraped thread as a real message
// tagged [outbound], even though parseMessengerMessageAriaLabel correctly
// recognizes the SAME text as a system card when given the clean aria-label
// extraction. Root cause: extractFacebookTranscript's raw-innerText fallback
// path (used whenever the aria parse bails) never strips the "Enter, <date>
// by <Name>:" prefix, so isMessengerSystemCardText's start-anchored
// (^.{1,48}) patterns never see the recognizable "sold"/"marked the
// listing" text within their window.
describe('Messenger system-card prefix stripping (2026-09-25)', () => {
  it('strips the "Enter, <date> by <Name>:" prefix so the clean text is recoverable', () => {
    const raw = 'Enter, September 2, 2026, 6:17 PM by Haley: Haley sold 2023 Ford F150 Raptor.';
    expect(cleanMessengerMessageText(raw)).toBe('Haley sold 2023 Ford F150 Raptor.');
  });

  it('recognizes a system-card sold notification as such after the prefix is stripped (regression: raw-innerText fallback path)', () => {
    const raw = 'Enter, September 2, 2026, 6:17 PM by Haley: Haley sold 2023 Ford F150 Raptor.';
    const cleaned = cleanMessengerMessageText(raw);
    expect(isMessengerSystemCardText(cleaned)).toBe(true);
  });

  it('fails to recognize the same text as a system card WITHOUT the prefix strip (proves the bug existed)', () => {
    const raw = 'Enter, September 2, 2026, 6:17 PM by Haley: Haley sold 2023 Ford F150 Raptor.';
    expect(isMessengerSystemCardText(raw)).toBe(false);
  });

  it('recognizes a "marked the listing" system card through the same prefix shape', () => {
    const raw = 'Enter, August 27, 2026, 11:29 AM by Haley: Haley marked the listing as sold.';
    expect(isMessengerSystemCardText(cleanMessengerMessageText(raw))).toBe(true);
  });

  it('does not strip a genuine message that merely contains the word "enter"', () => {
    const raw = 'Please enter through the side door when you arrive.';
    expect(cleanMessengerMessageText(raw)).toBe(raw);
  });

  it('does not corrupt a genuine customer message with no "Enter, ... by" prefix', () => {
    const raw = 'hi Yancy! i sent you a few texts - are you able to come see the truck today - thurs?';
    expect(cleanMessengerMessageText(raw)).toBe(raw);
    expect(isMessengerSystemCardText(raw)).toBe(false);
  });
});
