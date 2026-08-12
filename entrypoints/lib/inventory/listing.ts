/**
 * Shared listing helpers for the mini panel.
 * Same merge + status + readiness rules as the dedicated /rep/inventory page.
 * CLIENT only. Live rows come from GET /api/v1/rep/inventory.
 * Seed fills spec/photo gaps from app.brevmont.com/rep-inventory-seed.json.
 */

export const LISTING_STATUSES = ['not_posted', 'pending', 'posted', 'sold'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  not_posted: 'Not Posted',
  pending: 'Pending',
  posted: 'Posted',
  sold: 'Sold',
};

export interface InventoryListing {
  id: string;
  title?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  price?: number | null;
  total_price?: number | null;
  internet_price?: number | null;
  doc_fee?: number | null;
  mileage?: number | null;
  vin?: string | null;
  stock_number?: string | null;
  photos?: string[] | null;
  description?: string | null;
  posted_status?: string | null;
  posted_at?: string | null;
  lead_count?: number | null;
  vdp_url?: string | null;
  source_url?: string | null;
  exterior_color?: string | null;
  interior_color?: string | null;
  body_style?: string | null;
  location?: string | null;
  condition?: string | null;
  seeded?: boolean;
}

export function normalizeListingStatus(raw?: string | null): ListingStatus {
  const value = String(raw || 'not_posted').trim().toLowerCase();
  return (LISTING_STATUSES as readonly string[]).includes(value) ? (value as ListingStatus) : 'not_posted';
}

export function listingStatusLabel(raw?: string | null): string {
  return LISTING_STATUS_LABELS[normalizeListingStatus(raw)];
}

export function isApiBackedInventoryId(id?: string | null): boolean {
  const value = String(id || '').trim();
  return !!value && !value.startsWith('seed-');
}

export function vehicleTitle(vehicle: InventoryListing): string {
  const parts = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
    .map((p) => (p == null ? '' : String(p).trim()))
    .filter(Boolean);
  return parts.join(' ') || 'Vehicle';
}

export function factDescription(vehicle: InventoryListing): string {
  const bits = [
    listingHeadline(vehicle),
    Number.isFinite(Number(vehicle.mileage)) ? `${Number(vehicle.mileage).toLocaleString()} miles` : null,
    vehicle.stock_number ? `Stock ${vehicle.stock_number}` : null,
    vehicle.vin && !/^placeholder/i.test(String(vehicle.vin)) ? `VIN ${vehicle.vin}` : null,
    Number.isFinite(Number(vehicle.total_price ?? vehicle.price))
      ? `Listed at $${Number(vehicle.total_price ?? vehicle.price).toLocaleString()}`
      : null,
    vehicle.exterior_color ? `Exterior ${vehicle.exterior_color}` : null,
    vehicle.location ? String(vehicle.location) : null,
  ].filter(Boolean);
  return bits.length ? `${bits.join('. ')}.` : '';
}

export function listingHeadline(vehicle: InventoryListing): string {
  if (vehicle.title?.trim()) return vehicle.title.trim();
  const built = vehicleTitle(vehicle);
  return built === 'Vehicle' ? 'Listing' : `Used ${built}`;
}

export function formatMoney(value?: number | null): string {
  if (value == null || !Number.isFinite(Number(value))) return 'Price on request';
  return `$${Number(value).toLocaleString()}`;
}

export function formatMiles(value?: number | null): string {
  if (value == null || !Number.isFinite(Number(value))) return 'Mileage unavailable';
  return `${Number(value).toLocaleString()} mi`;
}

export function primaryPhoto(vehicle: InventoryListing): string | null {
  return (vehicle.photos || []).find(Boolean) || null;
}

function identityKey(vehicle: Pick<InventoryListing, 'vin' | 'stock_number' | 'id'>): string {
  const vin = String(vehicle.vin || '').trim().toUpperCase();
  if (vin && !/^placeholder/i.test(vin)) return `vin:${vin}`;
  const stock = String(vehicle.stock_number || '').trim().toUpperCase();
  if (stock && !/^placeholder/i.test(stock)) return `stock:${stock}`;
  return `id:${vehicle.id}`;
}

function asListing(raw: InventoryListing): InventoryListing {
  const photos = Array.isArray(raw.photos) ? raw.photos.filter(Boolean) : [];
  const total = raw.total_price ?? raw.price ?? null;
  return {
    ...raw,
    photos,
    price: total,
    total_price: total,
    posted_status: normalizeListingStatus(raw.posted_status),
    description: raw.description?.trim() || factDescription(raw) || null,
  };
}

export function mergeLiveAndSeed(live: InventoryListing[], seed: InventoryListing[]): InventoryListing[] {
  const byKey = new Map<string, InventoryListing>();
  for (const row of seed) byKey.set(identityKey(row), asListing(row));
  for (const row of live) {
    const key = identityKey(row);
    const prior = byKey.get(key);
    byKey.set(key, {
      ...(prior || {}),
      ...row,
      id: row.id || prior?.id || key,
      photos: (row.photos && row.photos.length ? row.photos : prior?.photos) || [],
      title: prior?.title || listingHeadline(row),
      total_price: row.price ?? prior?.total_price ?? null,
      price: row.price ?? prior?.price ?? null,
      posted_status: normalizeListingStatus(row.posted_status),
      source_url: prior?.source_url || row.vdp_url || null,
      vdp_url: row.vdp_url || prior?.vdp_url || null,
      description: row.description?.trim() || prior?.description || factDescription({ ...(prior || {}), ...row }),
      seeded: prior?.seeded ?? false,
    });
  }
  return Array.from(byKey.values());
}

export type ReadinessLevel = 'ready' | 'warn' | 'blocked';

export interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail: string;
}

export interface ListingReadiness {
  level: ReadinessLevel;
  checks: ReadinessCheck[];
  canInject: boolean;
  summary: string;
}

function hasText(value?: string | number | null): boolean {
  if (value == null) return false;
  return String(value).trim().length > 0 && !/^placeholder/i.test(String(value).trim());
}

export function assessListingReadiness(vehicle: InventoryListing): ListingReadiness {
  const photos = (vehicle.photos || []).filter((src) => typeof src === 'string' && /^https?:\/\//i.test(src)).length;
  const title = listingHeadline(vehicle);
  const checks: ReadinessCheck[] = [
    {
      key: 'title',
      label: 'Title',
      required: true,
      ok: hasText(title) && title !== 'Listing' && title !== 'Vehicle',
      detail: hasText(title) ? title : 'Year, make, and model are missing',
    },
    {
      key: 'price',
      label: 'Price',
      required: true,
      ok: Number.isFinite(Number(vehicle.total_price ?? vehicle.price)) && Number(vehicle.total_price ?? vehicle.price) > 0,
      detail: Number.isFinite(Number(vehicle.total_price ?? vehicle.price))
        ? formatMoney(vehicle.total_price ?? vehicle.price)
        : 'Price is missing',
    },
    {
      key: 'mileage',
      label: 'Mileage',
      required: true,
      ok: Number.isFinite(Number(vehicle.mileage)) && Number(vehicle.mileage) >= 0,
      detail: Number.isFinite(Number(vehicle.mileage)) ? formatMiles(vehicle.mileage) : 'Mileage is missing',
    },
    {
      key: 'photos',
      label: 'Photos',
      required: true,
      ok: photos >= 1,
      detail: photos >= 1 ? `${photos} photo${photos === 1 ? '' : 's'}` : 'No photos loaded',
    },
    {
      key: 'description',
      label: 'Description',
      required: true,
      ok: hasText(vehicle.description) && String(vehicle.description).trim().length >= 20,
      detail: hasText(vehicle.description) ? 'Description present' : 'Description is missing',
    },
    {
      key: 'vin',
      label: 'VIN',
      required: false,
      ok: hasText(vehicle.vin),
      detail: hasText(vehicle.vin) ? String(vehicle.vin) : 'VIN is missing',
    },
    {
      key: 'stock',
      label: 'Stock',
      required: false,
      ok: hasText(vehicle.stock_number),
      detail: hasText(vehicle.stock_number) ? String(vehicle.stock_number) : 'Stock number is missing',
    },
  ];
  if (photos === 1) {
    checks.push({
      key: 'photo_set',
      label: 'Photo set',
      required: false,
      ok: false,
      detail: 'Only one photo on the record. Full VDP gallery may still be loading',
    });
  }
  const missingRequired = checks.filter((c) => c.required && !c.ok);
  const missingOptional = checks.filter((c) => !c.required && !c.ok);
  const level: ReadinessLevel = missingRequired.length ? 'blocked' : missingOptional.length ? 'warn' : 'ready';
  return {
    level,
    checks,
    canInject: missingRequired.length === 0,
    summary: missingRequired.length
      ? `Missing ${missingRequired.map((c) => c.label.toLowerCase()).join(', ')}`
      : missingOptional.length
        ? `Ready with gaps: ${missingOptional.map((c) => c.label.toLowerCase()).join(', ')}`
        : 'Ready to inject',
  };
}

export const SEED_PATH = '/rep-inventory-seed.json';

export async function loadSeedListings(appBase: string): Promise<InventoryListing[]> {
  const url = `${appBase.replace(/\/$/, '')}${SEED_PATH}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const body = await res.json().catch(() => []);
  return Array.isArray(body) ? body.map(asListing) : [];
}
