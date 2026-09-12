import { describe, expect, it } from 'vitest';
import { resolveRepIndustryContext } from '../../entrypoints/lib/repIndustryContext';

describe('resolveRepIndustryContext', () => {
  it('keeps personal reps general when the server marks them personal', () => {
    expect(resolveRepIndustryContext({ is_automotive: false, feature_flags: { personal_rep: true } }).isAutomotive).toBe(false);
  });

  it('preserves automotive behavior for an explicit automotive account', () => {
    expect(resolveRepIndustryContext({ is_automotive: true }).isAutomotive).toBe(true);
  });

  it('defaults unknown accounts to general-sales safe behavior', () => {
    expect(resolveRepIndustryContext({}).isAutomotive).toBe(false);
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
