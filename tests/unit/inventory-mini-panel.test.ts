import { describe, expect, it } from 'vitest';
import {
  assessListingReadiness,
  isApiBackedInventoryId,
  listingHeadline,
  mergeLiveAndSeed,
  normalizeListingStatus,
} from '../../entrypoints/lib/inventory/listing';
import { renderMiniDetail as detail, renderMiniList as list } from '../../entrypoints/lib/inventory/miniPanel';
import {
  findFieldByLabels,
  injectMarketplaceDraft,
  MARKETPLACE_FIELD_MAP,
} from '../../entrypoints/lib/inventory/marketplaceInject';

const mustang = {
  id: 'live-1',
  title: 'Used 2014 Ford Mustang V6 Premium',
  year: 2014,
  make: 'Ford',
  model: 'Mustang',
  trim: 'V6 Premium',
  price: 9960,
  total_price: 9960,
  mileage: 154427,
  vin: '1ZVBP8AM7E5306530',
  stock_number: 'P44028',
  photos: [
    'https://media-cdn-tango.jazelc.com/media/319995290',
    'https://media-cdn-tango.jazelc.com/media/319995291',
  ],
  description: 'One-owner Mustang with a clean Carfax and recent service.',
  posted_status: 'not_posted',
};

describe('listing merge and status', () => {
  it('lets live status win and keeps seed photos', () => {
    const merged = mergeLiveAndSeed(
      [{ id: 'live-1', vin: '1ZVBP8AM7E5306530', posted_status: 'pending', photos: [] }],
      [mustang],
    );
    const row = merged.find((v) => v.vin === '1ZVBP8AM7E5306530');
    expect(row?.id).toBe('live-1');
    expect(normalizeListingStatus(row?.posted_status)).toBe('pending');
    expect(row?.photos?.[0]).toContain('jazelc.com');
  });

  it('treats seed ids as not API-backed', () => {
    expect(isApiBackedInventoryId('seed-1ZVBP8AM7E5306530')).toBe(false);
    expect(isApiBackedInventoryId('live-1')).toBe(true);
  });
});

describe('readiness', () => {
  it('blocks when photos are missing', () => {
    const ready = assessListingReadiness({ ...mustang, photos: [] });
    expect(ready.canInject).toBe(false);
    expect(ready.level).toBe('blocked');
  });

  it('blocks when description is missing', () => {
    const ready = assessListingReadiness({ ...mustang, description: 'Nice car' });
    expect(ready.canInject).toBe(false);
    expect(ready.level).toBe('blocked');
  });

  it('is ready when the payload is complete', () => {
    const ready = assessListingReadiness(mustang);
    expect(ready.level).toBe('ready');
    expect(ready.canInject).toBe(true);
  });
});

describe('mini panel render', () => {
  it('shows thumbnail, price, stock, and status chip', () => {
    const html = list([mustang], '');
    expect(html).toContain('Used 2014 Ford Mustang');
    expect(html).toContain('$9,960');
    expect(html).toContain('Stock P44028');
    expect(html).toContain('inv-chip-not_posted');
    expect(html).toContain('data-inv-id="live-1"');
  });

  it('detail exposes status and Post without claiming Publish', () => {
    const html = detail(mustang);
    expect(html).toContain('1ZVBP8AM7E5306530');
    expect(html).toContain('data-inv-post="live-1"');
    expect(html).toContain('Nothing posts by itself');
    expect(listingHeadline(mustang)).toContain('Mustang');
  });
});

describe('marketplace inject scaffold', () => {
  it('maps required create fields and leaves comboboxes to the rep', () => {
    const keys = MARKETPLACE_FIELD_MAP.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining([
      'vehicle_type', 'year', 'make', 'model', 'mileage', 'price',
      'body_style', 'condition', 'exterior_color', 'interior_color',
      'description', 'photos', 'location', 'title',
    ]));
    expect(MARKETPLACE_FIELD_MAP.filter((f) => f.autofill === 'attempt').map((f) => f.key)).toEqual([
      'title', 'mileage', 'price', 'description',
    ]);
    expect(MARKETPLACE_FIELD_MAP.find((f) => f.key === 'year')?.autofill).toBe('attempt_combo');
  });

  it('fills price and mileage when those inputs exist', async () => {
    document.body.innerHTML = `
      <input aria-label="Price" />
      <input aria-label="Mileage" />
      <textarea aria-label="Description"></textarea>
      <div role="combobox" aria-label="Year"></div>
      <div role="option">2014</div>
    `;
    const report = await injectMarketplaceDraft(document, mustang);
    expect(report.publish).toBe('not_clicked');
    expect(report.filled.find((f) => f.key === 'price')?.status).toBe('filled');
    expect(report.filled.find((f) => f.key === 'year')?.status).toBe('filled');
    expect((document.querySelector('[aria-label="Price"]') as HTMLInputElement).value).toBe('9960');
    expect(findFieldByLabels(document, ['Price'])).toBeTruthy();
  });
});
