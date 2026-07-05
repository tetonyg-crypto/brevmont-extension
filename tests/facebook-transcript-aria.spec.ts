import { test, expect } from '@playwright/test';
import { parseMessengerMessageAriaLabel } from '../entrypoints/lib/facebookTranscript';

test('Messenger aria message rows deterministically type customer and rep turns', () => {
  const inbound = parseMessengerMessageAriaLabel(
    'Enter, Message sent 12:20 PM by Cardog: What do you mean I haven’t bought it yet',
  );
  expect(inbound).toMatchObject({
    ok: true,
    speaker: 'Cardog',
    text: 'What do you mean I haven’t bought it yet',
    direction: 'inbound',
    method: 'aria_by_contact',
  });

  const outbound = parseMessengerMessageAriaLabel(
    'Enter, Message sent 8:51 AM by You: lol all good. so which one works, today after 4 or tomorrow morning?',
  );
  expect(outbound).toMatchObject({
    ok: true,
    speaker: 'You',
    text: 'lol all good. so which one works, today after 4 or tomorrow morning?',
    direction: 'outbound',
    method: 'aria_by_you',
  });
});

test('Messenger aria parser rejects system and metadata rows as speech', () => {
  expect(parseMessengerMessageAriaLabel('Conversation titled Cardog · 2025 Subaru Ascent').ok).toBe(false);
  expect(parseMessengerMessageAriaLabel('Marketplace SOLD - 2025 Subaru Ascent See details More options').ok).toBe(false);
  expect(
    parseMessengerMessageAriaLabel(
      'At 3:20 PM, Cardog: You can now rate each other People may rate one another based on their interactions or transactions. Rate Cardog',
    ).ok,
  ).toBe(false);
});
