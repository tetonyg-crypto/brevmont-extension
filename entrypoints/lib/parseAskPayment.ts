export type AskPaymentCalc = {
  price: number;
  down: number;
  months: number;
  apr: number;
  principal: number;
  payment: number;
  assumedApr: boolean;
};

function amountFromMatch(raw: string, hasK: boolean): number {
  const n = Number(String(raw || '').replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return hasK ? Math.round(n * 1000) : Math.round(n);
}

export function parseAskPayment(question: string): AskPaymentCalc | null {
  const text = String(question || '');
  const months = Number((text.match(/([0-9]{2,3})\s*(?:months?|mos?|mo\b)/i) || [])[1] || 0);
  const aprMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*%/)
    || text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:apr|rate)/i);
  const apr = aprMatch ? Number(aprMatch[1]) : 0;

  const downMatch = text.match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(k)?\s*(?:down|dn\b)/i)
    || text.match(/(?:down|dn)\s*(?:payment)?\D{0,8}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(k)?/i);

  const priceMatch = text.match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,7}|[0-9]{1,3})\s*(k)?\s*(?:price|car|vehicle|truck|suv|unit|tahoe|silverado|camry|f-?150)\b/i)
    || text.match(/(?:price|car|vehicle|truck|suv|unit|amount|on)\D{0,20}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,7}|[0-9]{1,3})\s*(k)?/i)
    || text.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,7})/);

  let price = 0;
  if (priceMatch) price = amountFromMatch(priceMatch[1], /k/i.test(priceMatch[0]));
  if (!price) {
    for (const match of text.matchAll(/\$?\s*([0-9]{1,3}(?:\.[0-9]+)?)\s*k\b/gi)) {
      const after = text.slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 18);
      if (/\b(down|dn)\b/i.test(after)) continue;
      price = amountFromMatch(match[1], true);
      if (price >= 5000) break;
    }
  }

  const down = downMatch ? amountFromMatch(downMatch[1], /k/i.test(downMatch[0])) : 0;
  if (!price || !months || months <= 0 || down >= price) return null;

  const assumedApr = !(apr > 0);
  const usedApr = assumedApr ? 9.9 : apr;
  const principal = price - down;
  const monthlyRate = usedApr / 100 / 12;
  const payment = monthlyRate === 0
    ? principal / months
    : principal * ((monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1));

  return { price, down, months, apr: usedApr, principal, payment, assumedApr };
}

export function formatAskPaymentAnswer(calc: AskPaymentCalc): string {
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const aprNote = calc.assumedApr ? `${calc.apr}% APR assumed because no rate was given` : `${calc.apr}% APR`;
  return `About ${money(calc.payment)} per month before taxes, registration, doc fee, warranty, or lender add-ons. That is ${money(calc.price)} price, ${money(calc.down)} down, ${money(calc.principal)} financed, ${aprNote}, ${calc.months} months. Use it as a desk number, then verify with finance.`;
}

export function looksLikeAskPromptLeak(text: string): boolean {
  return /best quick answer with what we have|make a reasonable assumption, state it|do not turn this into a customer follow-up/i.test(text || '');
}
