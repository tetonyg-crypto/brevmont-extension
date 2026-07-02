export interface BadgeUsage {
  remaining?: number | null;
  generations_remaining?: number | null;
  generations_limit?: number | null;
  generations_used?: number | null;
}

export interface FreeTierBadgeStateInput {
  usage?: BadgeUsage | null;
  tier?: string | null;
  localTier?: string | null;
  localUsage?: BadgeUsage | null;
}

export interface FreeTierBadgeState {
  freeTier: boolean;
  text: string;
  backgroundColor?: string;
}

const FREE_BADGE_COLOR = '#0D6E6E';

export function isFreeBadgeTier(value: unknown): boolean {
  const tier = String(value || '').trim().toLowerCase();
  return tier === 'free' || tier === 'free_trial';
}

export function resolveFreeTierBadgeState({
  usage,
  tier,
  localTier,
  localUsage,
}: FreeTierBadgeStateInput = {}): FreeTierBadgeState {
  const resolvedTier = String(tier || localTier || '').trim().toLowerCase();
  if (!isFreeBadgeTier(resolvedTier)) {
    return { freeTier: false, text: '' };
  }

  const storedUsage = localUsage || {};
  const remaining = Number(
    usage?.remaining ??
    usage?.generations_remaining ??
    storedUsage.generations_remaining ??
    Math.max(0, Number(storedUsage.generations_limit || 500) - Number(storedUsage.generations_used || 0)),
  );

  return {
    freeTier: true,
    text: Number.isFinite(remaining) ? String(Math.max(0, remaining)) : '',
    backgroundColor: FREE_BADGE_COLOR,
  };
}
