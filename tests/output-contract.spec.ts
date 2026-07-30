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

test('recovers the text draft when its fence marker uses the wrong bracket count', () => {
  // Malformed-fence resilience: the model slips to two brackets on the TEXT
  // marker but keeps EMAIL/CRM correct. Before the tolerant regex + leading-
  // chunk rescue, the entire text draft (the most-used output) was silently
  // dropped and the rep saw only email + CRM with no error.
  const raw = "[[TEXT]]Hey Dana, still have the Traverse ready for you. Want to come take a look? [[[EMAIL]]]Subject: Your Traverse Hi Dana, it's ready. [[[CRM NOTE]]]Dana following up on Traverse.";
  const parsed = parseGenerationSections(raw, 'all');

  expect(parsed.text).toContain('Hey Dana, still have the Traverse ready');
  expect(parsed.text).not.toContain('Subject:');
  expect(parsed.email).toContain('Subject: Your Traverse');
  expect(parsed.crm).toContain('Dana following up on Traverse');
});

test('recovers a leading text draft that has no marker at all before EMAIL', () => {
  // The model forgets the TEXT marker entirely and just starts writing, then
  // emits [[[EMAIL]]] and [[[CRM NOTE]]]. The leading unlabeled chunk is the
  // text draft and must be rescued into `text`, not discarded.
  const raw = "Hey Sam, the Suburban is still on the lot. Can you swing by this week? [[[EMAIL]]]Subject: Suburban Hi Sam, still available. [[[CRM NOTE]]]Sam asked about Suburban availability.";
  const parsed = parseGenerationSections(raw, 'all');

  expect(parsed.text).toContain('Hey Sam, the Suburban is still on the lot');
  expect(parsed.email).toContain('Subject: Suburban');
  expect(parsed.crm).toContain('Sam asked about Suburban availability');
});

test('does NOT rescue a conversational preamble as the text draft', () => {
  // Regression guard: a model lead-in before the first fence must not become a
  // sendable text message. Only genuine customer-facing drafts get rescued.
  const raw = "Sure, here is the email you asked for: [[[EMAIL]]]Subject: Your Traverse Hi Dana, it's ready. [[[CRM NOTE]]]Dana following up.";
  const parsed = parseGenerationSections(raw, 'all');

  expect(parsed.text).toBe('');
  expect(parsed.email).toContain('Subject: Your Traverse');
  expect(parsed.crm).toContain('Dana following up');
});

test('a single stray bracket token in prose is not treated as a fence marker', () => {
  // Only >=2 markers trigger the fenced path, so one bracketed token mid-reply
  // (even uppercase) stays part of the text instead of fabricating an empty
  // email section and truncating the real draft.
  const raw = 'Yes it is available. Reply with [[EMAIL]] to get the full breakdown.';
  const parsed = parseGenerationSections(raw, 'text');

  expect(parsed.text).toContain('Reply with [[EMAIL]] to get the full breakdown');
  expect(parsed.email).toBe('');
});

test('parses lowercase / mixed-case fence markers instead of losing all content', () => {
  // Case-drift tolerance: a full lowercase or mixed-case marker set must still
  // split correctly rather than collapse to empty (the regression that dropping
  // the case-insensitive flag would have caused).
  const raw = '[[[text]]]Hey Dana, still available. Want to come by? [[[email]]]Subject: Ready Hi Dana. [[[crm note]]]Dana following up.';
  const parsed = parseGenerationSections(raw, 'all');

  expect(parsed.text).toContain('Hey Dana, still available');
  expect(parsed.email).toContain('Subject: Ready');
  expect(parsed.crm).toContain('Dana following up');
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
