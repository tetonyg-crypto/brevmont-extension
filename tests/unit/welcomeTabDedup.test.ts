import { describe, expect, it, vi } from 'vitest';
import { BREVMONT_WELCOME_URL, openOrFocusWelcomeTab } from '../../entrypoints/lib/cwsDistribution';

// Founder-reported defect 2026-09-25: three near-identical browser tabs
// opened around a single install/onboarding flow. Root cause: two
// independent, uncoordinated call sites each did a raw chrome.tabs.create
// to BREVMONT_WELCOME_URL with no check for one already being open --
// background.ts's onInstalled handler (when cookie auto-config doesn't
// land) and the side panel's own "Get started" button. Both now route
// through this shared helper.
describe('openOrFocusWelcomeTab (2026-09-25)', () => {
  it('opens a new tab when no welcome tab is already open', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const create = vi.fn().mockResolvedValue({ id: 1 });
    const update = vi.fn();
    await openOrFocusWelcomeTab({ query, create, update });
    expect(create).toHaveBeenCalledWith({ url: BREVMONT_WELCOME_URL, active: true });
    expect(update).not.toHaveBeenCalled();
  });

  it('focuses the existing tab instead of opening a duplicate', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 42, windowId: 7 }]);
    const create = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    const windowsUpdate = vi.fn().mockResolvedValue(undefined);
    await openOrFocusWelcomeTab({ query, create, update }, { update: windowsUpdate });
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(42, { active: true });
    expect(windowsUpdate).toHaveBeenCalledWith(7, { focused: true });
  });

  it('queries by the welcome URL origin, not the full URL with query params', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const create = vi.fn().mockResolvedValue({ id: 1 });
    const update = vi.fn();
    await openOrFocusWelcomeTab({ query, create, update });
    const [{ url: queriedUrl }] = query.mock.calls[0];
    expect(queriedUrl).toBe('https://app.brevmont.com/welcome*');
  });

  it('falls back to opening a new tab if tabs.query throws', async () => {
    const query = vi.fn().mockRejectedValue(new Error('query unsupported'));
    const create = vi.fn().mockResolvedValue({ id: 1 });
    const update = vi.fn();
    await openOrFocusWelcomeTab({ query, create, update });
    expect(create).toHaveBeenCalledWith({ url: BREVMONT_WELCOME_URL, active: true });
  });

  it('still focuses the existing tab even when no windows API is provided', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 42, windowId: 7 }]);
    const create = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    await openOrFocusWelcomeTab({ query, create, update });
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(42, { active: true });
  });
});
