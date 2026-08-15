import { describe, expect, it } from 'vitest';
import { formatAskPaymentAnswer, looksLikeAskPromptLeak, parseAskPayment } from '../../entrypoints/lib/parseAskPayment';

describe('parseAskPayment', () => {
  it('parses 72 months 30k car 2k down 9%', () => {
    const calc = parseAskPayment('72 MONTHS 30K CAR 2K DOWN 9%');
    expect(calc).toMatchObject({
      price: 30000,
      down: 2000,
      months: 72,
      apr: 9,
      assumedApr: false,
    });
    expect(formatAskPaymentAnswer(calc!)).toMatch(/About \$/);
    expect(formatAskPaymentAnswer(calc!)).not.toMatch(/reasonable assumption/);
  });

  it('detects leaked developer instructions', () => {
    expect(looksLikeAskPromptLeak('Best quick answer with what we have: make a reasonable assumption, state it, answer directly')).toBe(true);
  });
});
