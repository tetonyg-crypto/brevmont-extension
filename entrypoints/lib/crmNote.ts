export const CRM_NOTE_LIMITS = {
  vinsolutions: 2000,
  default: 2000,
} as const;

export function crmNoteLimitForPlatform(platform: string): number {
  const key = String(platform || '').toLowerCase() as keyof typeof CRM_NOTE_LIMITS;
  return CRM_NOTE_LIMITS[key] || CRM_NOTE_LIMITS.default;
}

export function trimCrmNoteForCompatibility(note: string, platform: string): {
  text: string;
  limit: number;
  trimmed: boolean;
} {
  const limit = crmNoteLimitForPlatform(platform);
  const text = String(note || '');
  if (text.length <= limit) return { text, limit, trimmed: false };
  return {
    text: text.slice(0, Math.max(0, limit - 1)).trimEnd() + '…',
    limit,
    trimmed: true,
  };
}
