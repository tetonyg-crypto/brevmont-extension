import { describe, expect, it } from 'vitest';
import { resolveRepIndustryContext } from '../../entrypoints/lib/repIndustryContext';

describe('resolveRepIndustryContext', () => {
  it('keeps personal reps general when the server marks them personal', () => {
    expect(resolveRepIndustryContext({ is_automotive: false, feature_flags: { personal_rep: true } }).isAutomotive).toBe(false);
  });

  it('preserves automotive behavior for an explicit automotive account', () => {
    expect(resolveRepIndustryContext({ is_automotive: true }).isAutomotive).toBe(true);
  });

  // 2026-09-24: dealership-table accounts (the whole product) never get an
  // explicit is_automotive/vertical flag synced today, so "unknown" must
  // default to automotive or every real dealership rep's Coach Me / Ask
  // Anything silently discards genuine AI responses. General-sales accounts
  // are still protected via the explicit personal/rep_monthly/
  // industry_agnostic checks above (see the first test in this file).
  it('defaults unknown dealership accounts to automotive behavior', () => {
    expect(resolveRepIndustryContext({}).isAutomotive).toBe(true);
  });

  it('prefers industry_profile over legacy automotive market heuristics', () => {
    expect(resolveRepIndustryContext({
      industry_profile: { industry: 'Commercial cleaning', offer: 'monthly facility service' },
      profile: { market: { marketType: 'metro' }, dealership: { avgNewPrice: '45000' } },
    }).isAutomotive).toBe(false);
  });

  it('still flags clear auto industry text as automotive', () => {
    expect(resolveRepIndustryContext({
      industry_profile: { industry: 'Auto sales', offer: 'new trucks' },
    }).isAutomotive).toBe(true);
  });
});
