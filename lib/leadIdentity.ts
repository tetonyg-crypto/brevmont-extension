const RECENT_CAPTURE_WINDOW_MS = 10 * 60 * 1000;
const WEAK_DUPLICATE_WINDOW_MS = 72 * 60 * 60 * 1000;

function compact(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function digits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

export function leadDateMs(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function canonicalProfileUrl(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    // Slug profiles do not need tracking params, but Facebook's legacy
    // profile.php URL stores the actual identity in ?id=. Preserve only
    // identity-bearing params so different people never collapse together.
    const identityQuery = path.toLowerCase().endsWith('/profile.php') || path.toLowerCase() === '/profile.php'
      ? (url.searchParams.get('id') ? `?id=${url.searchParams.get('id')}` : '')
      : '';
    return `${host}${path}${identityQuery}`.toLowerCase();
  } catch {
    return compact(raw).replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

function metadataOf(lead: any): Record<string, any> {
  return lead?.metadata && typeof lead.metadata === 'object' ? lead.metadata : {};
}

export function strongLeadIdentityKeys(lead: any): string[] {
  if (!lead || typeof lead !== 'object') return [];
  const metadata = metadataOf(lead);
  const platform = compact(lead.source_platform || lead.source || metadata.platform || 'unknown');
  const profileUrl = canonicalProfileUrl(lead.profile_url || metadata.profile_url);
  const username = compact(lead.username || metadata.username).replace(/^@/, '');
  const threadKey = compact(
    lead.conversation_key
      || lead.thread_fingerprint
      || lead.context_fingerprint
      || metadata.overdrive_conversation_key
      || metadata.conversation_key
      || metadata.thread_fingerprint
      || metadata.context_fingerprint,
  );
  const phone = digits(lead.phone || metadata.phone);
  const email = compact(lead.email || metadata.email);
  const keys = [
    lead.id ? `id:${String(lead.id)}` : '',
    profileUrl ? `profile:${profileUrl}` : '',
    username ? `username:${platform}:${username}` : '',
    threadKey.length >= 4 ? `thread:${threadKey}` : '',
    phone.length >= 7 ? `phone:${phone}` : '',
    email.includes('@') ? `email:${email}` : '',
  ];
  return [...new Set(keys.filter(Boolean))];
}

function hasContactConflict(a: any, b: any): boolean {
  const aPhone = digits(a?.phone);
  const bPhone = digits(b?.phone);
  if (aPhone.length >= 7 && bPhone.length >= 7 && aPhone !== bPhone) return true;
  const aEmail = compact(a?.email);
  const bEmail = compact(b?.email);
  return Boolean(aEmail && bEmail && aEmail !== bEmail);
}

/**
 * Conservative fallback for old rows that predate stable thread/profile keys.
 * It intentionally requires the same platform, exact name, exact vehicle, and
 * a short capture window so two unrelated people with a common name do not
 * collapse into one lead.
 */
export function likelyLegacyDuplicate(a: any, b: any): boolean {
  if (!a || !b || hasContactConflict(a, b)) return false;
  const platformA = compact(a.source_platform || a.source);
  const platformB = compact(b.source_platform || b.source);
  const nameA = compact(a.customer_name || a.name);
  const nameB = compact(b.customer_name || b.name);
  const vehicleA = compact(a.vehicle_interest || a.vehicle);
  const vehicleB = compact(b.vehicle_interest || b.vehicle);
  if (!platformA || platformA !== platformB || !nameA || nameA !== nameB) return false;
  if (!vehicleA || vehicleA !== vehicleB) return false;
  const timeA = leadDateMs(a.last_activity_at || a.updated_at || a.captured_at);
  const timeB = leadDateMs(b.last_activity_at || b.updated_at || b.captured_at);
  return Boolean(timeA && timeB && Math.abs(timeA - timeB) <= WEAK_DUPLICATE_WINDOW_MS);
}

function preferValue(primary: any, secondary: any): any {
  return primary !== null && primary !== undefined && primary !== '' ? primary : secondary;
}

export function mergeLeadCopies(primary: any, secondary: any): any {
  const primaryMeta = metadataOf(primary);
  const secondaryMeta = metadataOf(secondary);
  const merged: any = { ...secondary, ...primary };
  for (const key of [
    'customer_name', 'phone', 'email', 'vehicle_interest', 'source_platform',
    'source_raw_text', 'pipeline_stage', 'status', 'appointment_at',
  ]) {
    merged[key] = preferValue(primary?.[key], secondary?.[key]);
  }
  merged.id = primary?.id || secondary?.id;
  merged.metadata = { ...primaryMeta };
  for (const [key, value] of Object.entries(secondaryMeta)) {
    if ((merged.metadata[key] === null || merged.metadata[key] === undefined || merged.metadata[key] === '')
      && value !== null && value !== undefined && value !== '') {
      merged.metadata[key] = value;
    }
  }
  merged.heat_score = Math.max(Number(primary?.heat_score || 0), Number(secondary?.heat_score || 0));
  const primaryActivity = leadDateMs(primary?.last_activity_at || primary?.updated_at || primary?.captured_at);
  const secondaryActivity = leadDateMs(secondary?.last_activity_at || secondary?.updated_at || secondary?.captured_at);
  if (secondaryActivity > primaryActivity) {
    merged.last_activity_at = secondary?.last_activity_at
      || (secondary?.updated_at ? new Date(secondary.updated_at).toISOString() : secondary?.captured_at);
  }
  merged.local_only = Boolean(primary?.local_only && secondary?.local_only);
  merged.duplicate_ids = [...new Set([
    ...(Array.isArray(primary?.duplicate_ids) ? primary.duplicate_ids : []),
    ...(Array.isArray(secondary?.duplicate_ids) ? secondary.duplicate_ids : []),
    primary?.id,
    secondary?.id,
  ].filter(Boolean))];
  return merged;
}

/** Remote rows must be passed first so their server ID remains authoritative. */
export function coalesceLeadRows(remoteLeads: any[], localLeads: any[]): any[] {
  const rows: any[] = [];
  const keyToIndex = new Map<string, number>();
  for (const lead of [...remoteLeads, ...localLeads]) {
    if (!lead || typeof lead !== 'object') continue;
    const keys = strongLeadIdentityKeys(lead);
    let index = keys.map((key) => keyToIndex.get(key)).find((value) => value !== undefined);
    if (index === undefined) index = rows.findIndex((row) => likelyLegacyDuplicate(row, lead));
    if (index >= 0) {
      rows[index] = mergeLeadCopies(rows[index], lead);
      for (const key of strongLeadIdentityKeys(rows[index])) keyToIndex.set(key, index);
      continue;
    }
    index = rows.length;
    rows.push(lead);
    for (const key of keys) keyToIndex.set(key, index);
  }
  return rows;
}

export function sortActiveLeadRows(leads: any[], now = Date.now()): any[] {
  return [...leads].sort((a, b) => {
    const aTime = leadDateMs(a.last_activity_at || a.updated_at || a.captured_at);
    const bTime = leadDateMs(b.last_activity_at || b.updated_at || b.captured_at);
    const aRecent = aTime > 0 && now - aTime <= RECENT_CAPTURE_WINDOW_MS ? 1 : 0;
    const bRecent = bTime > 0 && now - bTime <= RECENT_CAPTURE_WINDOW_MS ? 1 : 0;
    if (aRecent !== bRecent) return bRecent - aRecent;
    if (aRecent && bRecent && aTime !== bTime) return bTime - aTime;
    const heat = Number(b.heat_score || 0) - Number(a.heat_score || 0);
    if (heat !== 0) return heat;
    return bTime - aTime;
  });
}

export function findStrongIdentityMatch<T = any>(leads: T[], candidate: any): T | null {
  const candidateKeys = new Set(strongLeadIdentityKeys(candidate));
  if (candidateKeys.size === 0) return null;
  return leads.find((lead: any) => strongLeadIdentityKeys(lead).some((key) => candidateKeys.has(key))) || null;
}
