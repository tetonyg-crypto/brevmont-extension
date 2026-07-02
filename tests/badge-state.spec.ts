import { test, expect } from '@playwright/test';
import { isFreeBadgeTier, resolveFreeTierBadgeState } from '../lib/badgeState';

test('trial and pilot tiers clear the toolbar badge', () => {
  for (const tier of ['trial_7d', 'founding_pilot', 'pilot', 'command']) {
    const state = resolveFreeTierBadgeState({
      tier,
      usage: { remaining: 500 },
    });

    expect(state.freeTier).toBe(false);
    expect(state.text).toBe('');
    expect(state.backgroundColor).toBeUndefined();
  }
});

test('free tier shows remaining follow-up count as toolbar badge control case', () => {
  const state = resolveFreeTierBadgeState({
    tier: 'free',
    usage: { remaining: 42 },
  });

  expect(state.freeTier).toBe(true);
  expect(state.text).toBe('42');
  expect(state.backgroundColor).toBe('#0D6E6E');
});

test('free_trial badge falls back to stored usage when status payload omits remaining', () => {
  const state = resolveFreeTierBadgeState({
    localTier: 'free_trial',
    localUsage: {
      generations_used: 125,
      generations_limit: 500,
    },
  });

  expect(isFreeBadgeTier('free_trial')).toBe(true);
  expect(state.freeTier).toBe(true);
  expect(state.text).toBe('375');
});

test('negative or exhausted free-tier remaining never renders below zero', () => {
  const state = resolveFreeTierBadgeState({
    tier: 'free',
    usage: { remaining: -3 },
  });

  expect(state.freeTier).toBe(true);
  expect(state.text).toBe('0');
});
