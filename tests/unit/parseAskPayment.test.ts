import { describe, expect, it } from 'vitest';
import { formatAskPaymentAnswer, localAskAnythingFallback, looksLikeAskPromptLeak, parseAskPayment } from '../../entrypoints/lib/parseAskPayment';

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

  it('answers non-payment Ask Anything chips instead of repeating the payment prompt', () => {
    expect(localAskAnythingFallback('How to handle a trade', { isAutomotive: true })).toMatch(/real number on the trade/i);
    expect(localAskAnythingFallback('Next question to ask')).toMatch(/one question that moves the deal/i);
    expect(localAskAnythingFallback('Credit concern', { isAutomotive: true })).toMatch(/Keep credit private/i);
    expect(localAskAnythingFallback('Set the appointment')).toMatch(/two concrete times/i);
    expect(localAskAnythingFallback('How to handle a trade', { isAutomotive: true })).not.toMatch(/Need a selling price/);
  });

  it('defaults missing industry to general sales, not automotive', () => {
    expect(localAskAnythingFallback('How to handle a trade')).not.toMatch(/real number on the trade/i);
    expect(localAskAnythingFallback('How to handle a trade')).toMatch(/customer goal/i);
  });
});
