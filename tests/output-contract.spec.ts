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

test('splits fenced sections even when the model runs them together with no line breaks', () => {
  // Reproduces the P0 2026-07-09 bug: the model emitted all three sections as
  // one continuous run-on paragraph with no newline before EMAIL/CRM NOTE, so
  // the old line-heading parser collapsed everything into `sections.text`.
  const raw = "[[[TEXT]]]Hey Frank, your car is ready and waiting for you. When works best for you to swing by and pick it up? [[[EMAIL]]]Subject: Your Car Is Ready for Pickup Hey Frank, Your car is ready and waiting for you at Mercedes of Indiana. Yancy Garcia Sales Consultant Mercedes of Indiana [[[CRM NOTE]]]Contact Frank about pickup | Car ready for customer pickup | Ready for pickup, awaiting customer contact";
  const parsed = parseGenerationSections(raw, 'all');

  expect(parsed.text).toBe('Hey Frank, your car is ready and waiting for you. When works best for you to swing by and pick it up?');
  expect(parsed.text).not.toContain('EMAIL');
  expect(parsed.text).not.toContain('Subject:');
  expect(parsed.email).toContain('Subject: Your Car Is Ready for Pickup');
  expect(parsed.email).not.toContain('[[[');
  expect(parsed.crm).toContain('Contact Frank about pickup');
});

test('rescues a bare CRM NOTE: heading that drifts in after fence markers were used', () => {
  // Partial model compliance: [[[TEXT]]] and [[[EMAIL]]] used correctly, but
  // the model reverts to a bare "CRM NOTE:" heading (no brackets, no line
  // break) for the third section. Without the inline-heading rescue, this
  // text would merge into the EMAIL chunk, and the CRM-word filter in
  // sanitizeCustomerFacingOutput would then drop the entire (now CRM-tainted)
  // email line, leaving `email` silently empty.
  const raw = "[[[TEXT]]]Hey Frank, your car is ready. [[[EMAIL]]]Subject: Ready for pickup. Hey Frank, come by anytime. CRM NOTE: Contact Frank about pickup, car ready.";
  const parsed = parseGenerationSections(raw, 'all');

  expect(parsed.text).toContain('Hey Frank, your car is ready');
  expect(parsed.email).toContain('Subject: Ready for pickup');
  expect(parsed.email).not.toBe('');
  expect(parsed.email).not.toMatch(/\bCRM\b/i);
  expect(parsed.crm).toContain('Contact Frank about pickup');
});

test('does not mis-split on ordinary mid-sentence phrasing that happens to contain a keyword', () => {
  // Adversarial check: the inline-heading rescue must not fire on casual
  // dealership phrasing that merely contains "text"/"message"/"email" mid-
  // clause -- only after a real sentence boundary, and only with a colon
  // (not the dash form, which is common in ordinary writing).
  const raw = "[[[TEXT]]]Hi John, Text: yes that works for me too. Talk soon. [[[EMAIL]]]Left him a message - he'll call back. His email is on file.";
  const parsed = parseGenerationSections(raw, 'all');

  expect(parsed.text).toContain('Text: yes that works for me too');
  expect(parsed.email).toContain("Left him a message - he'll call back");
  expect(parsed.email).toContain('His email is on file');
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
