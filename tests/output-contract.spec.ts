import { test, expect } from '@playwright/test';
import { parseGenerationSections, sanitizeCustomerFacingOutput } from '../entrypoints/lib/outputContract';

test('parses message, email, and crm into separate sanitized fields', () => {
  const parsed = parseGenerationSections(`
TEXT:
Hey John, yes, it is still available. Want me to set it aside for you?
---
EMAIL:
Hi John,

Yes, it is still available. I can help you take the next step.

CRM NOTE:
Customer asked whether the Silverado is still available.
`, 'all');

  expect(parsed.text).toBe('Hey John, yes, it is still available. Want me to set it aside for you?');
  expect(parsed.email).toContain('Hi John');
  expect(parsed.crm).toContain('Customer asked whether');
  expect(parsed.text).not.toContain('---');
  expect(parsed.text).not.toMatch(/\bCRM\b/i);
});

test('cuts classifier/meta tails out of customer-facing output', () => {
  const parsed = parseGenerationSections(`
MESSAGE:
Hey Chris, I can still help with the payment. Want me to send options?
---
I'll also generate the classification for your records:
classification: payment objection
`, 'text');

  expect(parsed.text).toBe('Hey Chris, I can still help with the payment. Want me to send options?');
  expect(parsed.text).not.toContain('classification');
  expect(parsed.text).not.toContain('for your records');
});

test('requested email fallback lands in email only', () => {
  const parsed = parseGenerationSections('Hi Sam, I can send the details over.', 'email');
  expect(parsed.email).toBe('Hi Sam, I can send the details over.');
  expect(parsed.text).toBe('');
  expect(parsed.crm).toBe('');
});

test('customer-facing sanitizer strips CRM/meta references and banned separators', () => {
  const text = sanitizeCustomerFacingOutput(`
Yes, it is available.
CRM: log this as inventory inquiry.
---
I'm also classifying this interaction for your CRM.
`, 'text');

  expect(text).toBe('Yes, it is available.');
  expect(text).not.toContain('CRM');
  expect(text).not.toContain('---');
  expect(text).not.toContain('classifying');
});
