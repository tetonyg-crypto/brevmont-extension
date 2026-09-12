export type RepIndustryContext = { isAutomotive: boolean; explicit: boolean };

/** Automotive behavior is opt-in; unknown/new profiles stay general-sales safe. */
export function resolveRepIndustryContext(input: any): RepIndustryContext {
  const source = input && typeof input === 'object' ? input : {};
  const flags = source.feature_flags && typeof source.feature_flags === 'object' ? source.feature_flags : source;
  const plan = String(source.plan || flags.plan || source.dealership_plan || '').trim().toLowerCase();
  if (/personal|rep_monthly|personal_rep/.test(plan)) return { isAutomotive: false, explicit: true };
  if (flags.is_automotive === true || flags.automotive_rep === true) return { isAutomotive: true, explicit: true };
  if (flags.is_automotive === false || flags.personal_rep === true || flags.industry_agnostic === true) return { isAutomotive: false, explicit: true };
  const vertical = String(source.prompt_vertical || source.industry_vertical || source.vertical || '').trim().toLowerCase();
  if (vertical) return { isAutomotive: /^(auto|automotive|car|cars|dealership)$/.test(vertical), explicit: true };
  // Prefer explicit industry_profile / access flags over legacy automotive
  // onboarding heuristics (marketType / salt / avg car price) so a cleaning
  // rep with a stale local profile blob stays general-sales.
  if (source.industry_profile || flags.industry_profile) {
    const ip = source.industry_profile || flags.industry_profile || {};
    const blob = `${ip.industry || ''} ${ip.offer || ''}`.toLowerCase();
    if (/\b(car|cars|auto|automotive|dealership|vehicle)\b/.test(blob) &&
        !/\b(clean|saas|software|freight|staff|insurance|real estate|construct)\b/.test(blob)) {
      return { isAutomotive: true, explicit: true };
    }
    return { isAutomotive: false, explicit: true };
  }
  const profile = source.profile || {};
  const dealership = profile.dealership || {};
  if (profile.market?.marketType || dealership.crm || dealership.saltRoads || dealership.avgNewPrice || dealership.avgUsedPrice) return { isAutomotive: true, explicit: true };
  return { isAutomotive: false, explicit: false };
}
