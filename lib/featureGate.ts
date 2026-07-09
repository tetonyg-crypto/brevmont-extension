export type ExtensionTier =
  | 'free'
  | 'free_trial'
  | 'founding_pilot'
  | 'founding_annual'
  | 'pilot'
  | 'floor'
  | 'operator'
  | 'command'
  | 'command_annual'
  | 'annual'
  | 'group';

const PAID_TIERS = new Set<ExtensionTier>([
  'founding_pilot',
  'founding_annual',
  'pilot',
  'floor',
  'operator',
  'command',
  'command_annual',
  'annual',
  'group',
]);

export interface FeatureAccess {
  generateText: boolean;
  generateEmail: boolean;
  generateCrmNote: boolean;
  voiceDictation: boolean;
  addLead: boolean;
  scanLead: boolean;
  coachMe: boolean;
  screenshotCapture: boolean;
  notifications: boolean;
  commandMode: boolean;
  stats: boolean;
  settings: boolean;
  markOutcome: boolean;
}

export function normalizeExtensionTier(value: unknown): ExtensionTier {
  const tier = String(value || 'free').trim().toLowerCase();
  if (tier === 'trial' || tier === 'starter' || tier === 'free_trial') return 'free';
  if (tier === 'core') return 'founding_pilot';
  if (tier === 'pro') return 'command';
  if (tier === 'elite') return 'group';
  if (tier === 'annual') return 'command_annual';
  return (tier || 'free') as ExtensionTier;
}

export function isPaidTierName(value: unknown): boolean {
  return PAID_TIERS.has(normalizeExtensionTier(value));
}

export async function getTier(): Promise<ExtensionTier> {
  const data = await chrome.storage.local.get(['brevmont_tier', 'dealership_tier']);
  return normalizeExtensionTier(data.brevmont_tier || data.dealership_tier || 'free');
}

export async function isPaidTier(): Promise<boolean> {
  return isPaidTierName(await getTier());
}

export function getFeatureAccessForTier(value: unknown): FeatureAccess {
  const paid = isPaidTierName(value);
  return {
    generateText: true,
    generateEmail: true,
    generateCrmNote: true,
    voiceDictation: true,
    addLead: paid,
    scanLead: paid,
    coachMe: paid,
    screenshotCapture: paid,
    notifications: paid,
    commandMode: paid,
    stats: paid,
    settings: paid,
    markOutcome: paid,
  };
}

export async function getFeatureAccess(): Promise<FeatureAccess> {
  return getFeatureAccessForTier(await getTier());
}

export function getLegacyFeatureFlagsForTier(value: unknown): Record<string, boolean> {
  const access = getFeatureAccessForTier(value);
  const paid = isPaidTierName(value);
  return {
    vinsolutions: true,
    generation: true,
    basic_logging: true,
    gm_dashboard: paid,
    ghost_leads: paid,
    rep_leaderboard: paid,
    objection_tracking: paid,
    facebook: paid,
    gmail: paid,
    linkedin: paid,
    voice_coach: access.coachMe,
    command_mode: access.commandMode,
    context_reply: access.screenshotCapture,
    voice_dictation: access.voiceDictation,
    lead_capture: access.addLead,
    lead_scan: access.scanLead,
    notifications: access.notifications,
    campaigns: false,
    multi_location: false,
    owner_dashboard: paid,
    priority_support: paid,
    automated_reactivation: false,
  };
}
