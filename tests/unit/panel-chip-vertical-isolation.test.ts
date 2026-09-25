/**
 * Regression coverage for the RC fix to entrypoints/lib/panelUI.ts and
 * entrypoints/sidepanel/main.ts: the dirty working tree had accidentally
 * duplicated the "Just looking" coach chip (a "Spouse not here" -> "Just
 * looking" overwrite collided with the existing chip) and, separately, two
 * copies of a dead regex were unconditionally stripping "Found it cheaper"
 * for every rep, including automotive reps who should keep it.
 *
 * getPanelHTML() is the shared base template (industry-neutral, no vertical
 * branching). Automotive-only chips are added/removed at render time by
 * removeAutomotivePresetsForGeneralRep() in sidepanel/main.ts, which is not
 * exported (WXT entrypoint, not a plain importable module) -- consistent
 * with this repo's existing convention (tests/unit/post-install-flow.test.ts),
 * that logic is verified via source assertions against the real file text.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPanelHTML } from '../../entrypoints/lib/panelUI';

function chipLabels(html: string, selector: 'coach-chip' | 'ask-chip'): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll(`.${selector}`)).map((el) => (el.textContent || '').trim());
}

describe('getPanelHTML base template: no duplicate chips', () => {
  it('has no duplicate coach-chip labels', () => {
    const labels = chipLabels(getPanelHTML('gmail'), 'coach-chip');
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('has no duplicate ask-chip labels', () => {
    const labels = chipLabels(getPanelHTML('gmail'), 'ask-chip');
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('keeps both base automotive-only coach chips exactly once (removed/added at render time, not in the shared template)', () => {
    const labels = chipLabels(getPanelHTML('gmail'), 'coach-chip');
    expect(labels.filter((l) => l === 'Spouse not here')).toHaveLength(1);
    expect(labels.filter((l) => l === 'Found it cheaper')).toHaveLength(1);
    expect(labels.filter((l) => l === 'Just looking')).toHaveLength(1);
  });

  it('base ask-chips are industry-neutral and never contain the automotive financing preset strings', () => {
    const labels = chipLabels(getPanelHTML('gmail'), 'ask-chip');
    expect(labels.some((l) => /72 months|30k|trade|credit concern|appointment/i.test(l))).toBe(false);
  });
});

describe('sidepanel/main.ts: automotive/general chip wiring (source-level, matches repo convention)', () => {
  const src = readFileSync(resolve(__dirname, '..', '..', 'entrypoints', 'sidepanel', 'main.ts'), 'utf8');

  it('renders the base panel markup unmodified (no leftover chip-stripping regex before automotive/general resolution runs)', () => {
    expect(src).toContain("root.innerHTML = getPanelHTML(currentPlatform.platform);");
    expect(src).not.toMatch(/getPanelHTML\(currentPlatform\.platform\)\.replace\(/);
  });

  it('automotive branch adds exactly the chips missing from the base template, with no overlap/duplication risk', () => {
    expect(src).toContain('<button class="coach-chip" data-automotive-preset>Bad credit</button><button class="coach-chip" data-automotive-preset>Trading in my car</button><button class="coach-chip" data-automotive-preset>Need to check with my bank</button>');
    expect(src).toContain('<button class="ask-chip" data-automotive-preset>72 months, 30k, 2k down, 9%</button><button class="ask-chip" data-automotive-preset>How to handle a trade</button><button class="ask-chip" data-automotive-preset>Credit concern</button><button class="ask-chip" data-automotive-preset>Set the appointment</button>');
  });

  it('automotive chip insertion is idempotent so re-running after real access data lands never duplicates the chips (AUTH-RUNTIME-003)', () => {
    expect(src).toContain("!coach.querySelector('[data-automotive-preset]')");
    expect(src).toContain("!ask.querySelector('[data-automotive-preset]')");
  });

  it('removeAutomotivePresetsForGeneralRep is re-run after renderAccountChip resolves real industry data, not only once before it exists (AUTH-RUNTIME-003)', () => {
    const occurrences = src.match(/renderAccountChip\(\)\.then\(\(\) => removeAutomotivePresetsForGeneralRep\(root\)\)/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('general-sales branch removes every automotive-only chip label, including the two baked into the base template', () => {
    const automotiveOnlyMatch = src.match(/const automotiveOnly = new Set\(\[([^\]]+)\]\)/);
    expect(automotiveOnlyMatch).not.toBeNull();
    const automotiveOnly = automotiveOnlyMatch![1];
    expect(automotiveOnly).toContain("'Spouse not here'");
    expect(automotiveOnly).toContain("'Found it cheaper'");
    expect(automotiveOnly).toContain("'Bad credit'");
    expect(automotiveOnly).toContain("'Trading in my car'");
    expect(automotiveOnly).toContain("'Need to check with my bank'");
  });
});
