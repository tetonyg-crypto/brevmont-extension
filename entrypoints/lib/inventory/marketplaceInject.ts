/**
 * Marketplace create/vehicle inject scaffold.
 *
 * Live Facebook login was skipped. Field map is Meta's Vehicle-for-sale create
 * flow. Combobox clicks are exploratory and often fail. Never click Publish.
 */

export type InjectAutofill = 'attempt' | 'attempt_combo' | 'attempt_blob' | 'n/a';

export interface MarketplaceFieldMap {
  key: string;
  labels: string[];
  kind: 'textbox' | 'textarea' | 'combobox' | 'file' | 'none';
  autofill: InjectAutofill;
  note: string;
}

export const MARKETPLACE_CREATE_VEHICLE_URL = 'https://www.facebook.com/marketplace/create/vehicle';

export const MARKETPLACE_FIELD_MAP: MarketplaceFieldMap[] = [
  { key: 'title', labels: ['Title', 'Listing title'], kind: 'textbox', autofill: 'attempt', note: 'Present on some Marketplace create steps. Vehicle-for-sale often builds title from year/make/model instead.' },
  { key: 'vehicle_type', labels: ['Vehicle type'], kind: 'combobox', autofill: 'attempt_combo', note: 'Custom combobox. Scaffold tries click + match. Rep usually selects.' },
  { key: 'year', labels: ['Year'], kind: 'combobox', autofill: 'attempt_combo', note: 'Custom combobox. Scaffold tries click + match.' },
  { key: 'make', labels: ['Make'], kind: 'combobox', autofill: 'attempt_combo', note: 'Depends on year. Custom combobox.' },
  { key: 'model', labels: ['Model'], kind: 'combobox', autofill: 'attempt_combo', note: 'Depends on make. Custom combobox.' },
  { key: 'mileage', labels: ['Mileage'], kind: 'textbox', autofill: 'attempt', note: 'Free-text. Native setter may stick.' },
  { key: 'price', labels: ['Price'], kind: 'textbox', autofill: 'attempt', note: 'Free-text. Native setter may stick.' },
  { key: 'body_style', labels: ['Body style'], kind: 'combobox', autofill: 'attempt_combo', note: 'Custom combobox.' },
  { key: 'condition', labels: ['Condition', 'Vehicle condition'], kind: 'combobox', autofill: 'attempt_combo', note: 'Excellent/Very Good/Good/Fair. Scrape only has used/new.' },
  { key: 'exterior_color', labels: ['Exterior color'], kind: 'combobox', autofill: 'attempt_combo', note: 'Color names may not match Meta list.' },
  { key: 'interior_color', labels: ['Interior color'], kind: 'combobox', autofill: 'attempt_combo', note: 'Custom combobox.' },
  { key: 'description', labels: ['Description'], kind: 'textarea', autofill: 'attempt', note: 'Textarea. Native setter may stick.' },
  { key: 'location', labels: ['Location'], kind: 'combobox', autofill: 'attempt_combo', note: 'City search. Do not invent an address.' },
  { key: 'photos', labels: ['Photos', 'Add photos', 'Add photo'], kind: 'file', autofill: 'attempt_blob', note: 'File input + DataTransfer. May fail CORS or React.' },
];

export interface MarketplaceDraftVehicle {
  id: string;
  title?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  price?: number | null;
  mileage?: number | null;
  vin?: string | null;
  stock_number?: string | null;
  description?: string | null;
  photos?: string[];
  exterior_color?: string | null;
  interior_color?: string | null;
  body_style?: string | null;
  location?: string | null;
  condition?: string | null;
}

export interface FieldFillResult {
  key: string;
  status: 'filled' | 'skipped_rep_click' | 'missing_field' | 'empty_value' | 'failed';
  detail: string;
}

export interface InjectReport {
  filled: FieldFillResult[];
  photos: { attempted: number; attached: number; detail: string };
  publish: 'not_clicked';
  honest: string;
}

function valueFor(key: string, vehicle: MarketplaceDraftVehicle): string {
  if (key === 'title') return String(vehicle.title || '');
  if (key === 'year') return vehicle.year == null ? '' : String(vehicle.year);
  if (key === 'make') return String(vehicle.make || '');
  if (key === 'model') return String(vehicle.model || '');
  if (key === 'mileage') return vehicle.mileage == null ? '' : String(vehicle.mileage);
  if (key === 'price') return vehicle.price == null ? '' : String(vehicle.price);
  if (key === 'description') return String(vehicle.description || '');
  if (key === 'body_style') return String(vehicle.body_style || '');
  if (key === 'exterior_color') return String(vehicle.exterior_color || '');
  if (key === 'interior_color') return String(vehicle.interior_color || '');
  if (key === 'location') return String(vehicle.location || '');
  if (key === 'condition') return String(vehicle.condition || '');
  if (key === 'vehicle_type') return 'Car/Truck';
  return '';
}

function norm(value: string): string {
  return value.trim().toLowerCase();
}

export function findFieldByLabels(root: ParentNode, labels: string[]): HTMLElement | null {
  if (!labels.length) return null;
  const wanted = labels.map(norm);
  const nodes = Array.from(root.querySelectorAll('input, textarea, [role="combobox"], [contenteditable="true"]')) as HTMLElement[];
  for (const node of nodes) {
    const hay = [
      node.getAttribute('aria-label'),
      node.getAttribute('placeholder'),
      node.getAttribute('name'),
      (node as HTMLInputElement).labels?.[0]?.textContent,
    ].filter(Boolean).map((v) => norm(String(v)));
    if (hay.some((h) => wanted.some((w) => h.includes(w)))) return node;
  }
  return null;
}

function setNativeValue(el: HTMLElement, value: string): boolean {
  try {
    if (el.getAttribute('contenteditable') === 'true') {
      el.textContent = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) desc.set.call(el, value);
    else (el as HTMLInputElement).value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

export function attemptCombobox(root: ParentNode, labels: string[], value: string): FieldFillResult {
  const el = findFieldByLabels(root, labels);
  if (!el) return { key: labels[0] || 'combobox', status: 'missing_field', detail: `No ${labels.join('/')} control found` };
  try { el.click(); } catch { /* exploratory */ }
  setNativeValue(el, value);
  const options = Array.from(root.querySelectorAll('[role="option"]')) as HTMLElement[];
  const match = options.find((opt) => norm(opt.textContent || '').includes(norm(value)));
  if (match) {
    try { match.click(); } catch { /* exploratory */ }
    return { key: labels[0] || 'combobox', status: 'filled', detail: `Clicked option matching ${value}` };
  }
  return {
    key: labels[0] || 'combobox',
    status: 'failed',
    detail: `Typed ${value}. No matching option. Rep must select.`,
  };
}

export async function attachPhotoFiles(input: HTMLInputElement, files: File[]): Promise<number> {
  if (!files.length) return 0;
  try {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.files?.length || 0;
  } catch {
    return 0;
  }
}

export async function injectMarketplaceDraft(
  root: ParentNode,
  vehicle: MarketplaceDraftVehicle,
  photoFiles: File[] = [],
): Promise<InjectReport> {
  const filled: FieldFillResult[] = [];
  for (const field of MARKETPLACE_FIELD_MAP) {
    if (field.key === 'photos') continue;
    const value = valueFor(field.key, vehicle).trim();
    if (!value) {
      filled.push({ key: field.key, status: 'empty_value', detail: field.note });
      continue;
    }
    if (field.autofill === 'attempt_combo') {
      const result = attemptCombobox(root, field.labels, value);
      filled.push({ ...result, key: field.key });
      continue;
    }
    const el = findFieldByLabels(root, field.labels);
    if (!el) {
      filled.push({ key: field.key, status: 'missing_field', detail: field.note });
      continue;
    }
    const ok = setNativeValue(el, value);
    filled.push({
      key: field.key,
      status: ok ? 'filled' : 'failed',
      detail: ok ? `Wrote ${value.slice(0, 80)}` : 'Native setter failed',
    });
  }

  let photos = { attempted: photoFiles.length, attached: 0, detail: 'No file input found' };
  const fileInput = root.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (photoFiles.length && fileInput) {
    const attached = await attachPhotoFiles(fileInput, photoFiles);
    photos = {
      attempted: photoFiles.length,
      attached,
      detail: attached
        ? `Attached ${attached} files. React may still ignore them.`
        : 'DataTransfer rejected. Rep must add photos.',
    };
  } else if (photoFiles.length) {
    photos = { attempted: photoFiles.length, attached: 0, detail: 'Photos fetched but no file input on this step' };
  } else {
    photos = { attempted: 0, attached: 0, detail: 'Photos not attached. CDN fetch may have failed.' };
  }

  return {
    filled,
    photos,
    publish: 'not_clicked',
    honest: 'Mileage, price, description, and title were attempted as text. Year, make, model, body, colors, condition, and location were attempted as combobox clicks and often need the rep. Photos used DataTransfer. Publish was not clicked.',
  };
}
