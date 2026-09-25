import { describe, expect, it } from 'vitest';
import { linkedInSenderLabelFromBubbleText } from '../../entrypoints/lib/leadContextScan';

// Founder runtime defect 2026-09-25: scanning a real LinkedIn conversation
// (a rep -- signed-in member "Yancy Garcia" -- messaging a prospect,
// "Gerardo Abinadi Flores", about knife engraving) produced a self-
// contradictory transcript where some of the rep's own sent messages were
// misclassified [inbound], as if the rep were the customer. Root cause:
// LinkedIn prepends an ALL-CAPS day-divider ("WEDNESDAY", "TODAY") to the
// first message bubble of each new day group, concatenated onto the same
// line as the sender lockup ("WEDNESDAY Yancy Garcia sent the following
// message..."). linkedInSenderLabelFromBubbleText's regex is anchored to
// the start of the string and requires Title Case, so the all-caps divider
// made it fail silently and the message fell through to inbound -- even
// though the exact same sender's later same-day messages (no divider
// prefix) classified correctly. That inconsistency, not the model, is why
// Generate produced a vague non-answer: the transcript looked like two
// different people were the "customer."
describe('LinkedIn day-divider direction-attribution bug (2026-09-25)', () => {
  it('extracts the sender name even with a day-divider prefix on the same line', () => {
    const text = 'WEDNESDAY Yancy Garcia sent the following message at 9:33 AM View Yancy’s profile Yancy Garcia 9:33 AM Do you do any B2B sales?';
    expect(linkedInSenderLabelFromBubbleText(text)).toBe('Yancy Garcia');
  });

  it('extracts the same sender label whether or not a day-divider is present, so downstream self-detection sees consistent input', () => {
    // linkedInMessageLooksOutbound's actual self-match (isLinkedInSelfOrCompanyLabel
    // -> linkedInSelfNames()) reads the signed-in member's name from the live
    // LinkedIn nav DOM, which a pure-function unit test has no way to simulate.
    // What this fix actually guarantees -- and what was broken -- is that the
    // SENDER LABEL extracted from the bubble text is identical either way, so
    // whatever self-check runs downstream gets the same input for every message
    // from the same person, divider or not.
    const withDivider = 'WEDNESDAY Yancy Garcia sent the following message at 9:33 AM View Yancy’s profile Yancy Garcia 9:33 AM Do you do any B2B sales?';
    const withoutDivider = 'Yancy Garcia sent the following message at 9:51 AM View Yancy’s profile Yancy Garcia 9:51 AM interesting what service/ product';
    expect(linkedInSenderLabelFromBubbleText(withDivider)).toBe(linkedInSenderLabelFromBubbleText(withoutDivider));
    expect(linkedInSenderLabelFromBubbleText(withDivider)).toBe('Yancy Garcia');
  });

  it('still correctly extracts the sender label with no divider present (regression guard)', () => {
    const text = 'Gerardo Abinadi Flores sent the following message at 9:57 AM View Gerardo Abinadi’s profile Gerardo Abinadi Flores 9:57 AM We sell knives';
    expect(linkedInSenderLabelFromBubbleText(text)).toBe('Gerardo Abinadi Flores');
  });

  it('handles TODAY and YESTERDAY dividers, not just weekday names', () => {
    expect(linkedInSenderLabelFromBubbleText('TODAY Yancy Garcia sent the following message at 2:00 PM hey')).toBe('Yancy Garcia');
    expect(linkedInSenderLabelFromBubbleText('YESTERDAY Yancy Garcia sent the following message at 2:00 PM hey')).toBe('Yancy Garcia');
  });

  it('handles a date-string divider ("SEP 23")', () => {
    expect(linkedInSenderLabelFromBubbleText('SEP 23 Yancy Garcia sent the following message at 2:00 PM hey')).toBe('Yancy Garcia');
  });
});
