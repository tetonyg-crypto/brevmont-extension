/**
 * Unit tests for the pure inventory extraction (entrypoints/lib/inventory/scrape.ts).
 * Runs under vitest with the happy-dom environment so DOMParser + querySelector
 * exist for the .vehicle-card path.
 *
 * Fixtures use the REAL field names verified live on Dealer.com / Dave Smith
 * Motors (2026-08): window.DDC.dataLayer.vehicles items, schema.org JSON-LD,
 * and Dealer.com .vehicle-card markup.
 */

import { describe, it, expect } from 'vitest';
import {
  extractFromDataLayer,
  extractJsonLdVehicles,
  extractDomCards,
  extractVehiclesFromPage,
  detectInventorySite,
  dedupeByVin,
  stripPhotoSizeParams,
} from '../../entrypoints/lib/inventory/scrape';

const BASE = 'https://www.davesmith.com/used-inventory/index.htm';

// ── Fixture 1: Dealer.com window.DDC.dataLayer.vehicles ────────────────────
const DDC_VEHICLES = [
  {
    vin: '1gcpybek5rz100001',
    stockNumber: 'RZ100001',
    modelYear: 2026,
    year: 2026,
    make: 'Chevrolet',
    model: 'Equinox',
    trim: 'RS All-Wheel Drive',
    odometer: 8966,
    bodyStyle: 'SUV',
    newOrUsed: 'used',
    exteriorColor: 'Black',
    // Real Dealer.com structure (verified live): askingPrice/finalPrice is the
    // ADVERTISED (lower, post-discount) price; internetPrice is the HIGHER
    // pre-discount number. finalPrice/askingPrice must win.
    pricing: { finalPrice: 34198, askingPrice: 34198, internetPrice: 35998, salePrice: 0, msrp: 39000 },
    images: [
      { alt: 'front', id: '1', title: 'front', uri: 'https://pictures.dealer.com/d/davesmith/0001.jpg?impolicy=downsize&w=520&h=390' },
      { alt: 'rear', id: '2', title: 'rear', uri: 'https://pictures.dealer.com/d/davesmith/0002.jpg?impolicy=downsize&w=520' },
    ],
    link: '/used/Chevrolet/2026-Chevrolet-Equinox-abc.htm',
    uuid: 'uuid-1',
  },
  {
    vin: '3gtu9ded7pg200002',
    stockNumber: 'PG200002',
    modelYear: 2023,
    make: 'GMC',
    model: 'Sierra 1500',
    trim: 'AT4',
    odometer: 22140,
    bodyStyle: 'Truck',
    newOrUsed: 'used',
    pricing: { askingPrice: 0, internetPrice: 0, salePrice: 51995, msrp: 0 },
    images: [{ uri: 'https://pictures.dealer.com/d/davesmith/0003.jpg?impolicy=downsize&w=520&h=390' }],
    link: 'https://www.davesmith.com/used/GMC/2023-GMC-Sierra-def.htm',
    uuid: 'uuid-2',
  },
];

// ── Fixture 2: JSON-LD Vehicle (with odometer + image) ─────────────────────
const JSONLD_HTML = `
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Vehicle",
  "name": "2022 Toyota Tacoma TRD Sport",
  "vehicleModelDate": "2022",
  "vehicleIdentificationNumber": "3tmcz5an9nm300003",
  "sku": "NM300003",
  "brand": { "@type": "Brand", "name": "Toyota" },
  "model": "Tacoma",
  "vehicleConfiguration": "TRD Sport",
  "mileageFromOdometer": { "@type": "QuantitativeValue", "value": 41250, "unitCode": "SMI" },
  "image": [
    "https://pictures.dealer.com/d/davesmith/9001.jpg?impolicy=downsize&w=800",
    { "@type": "ImageObject", "url": "https://pictures.dealer.com/d/davesmith/9002.jpg?w=800&h=600" }
  ],
  "offers": { "@type": "Offer", "price": 38995, "priceCurrency": "USD", "availability": "https://schema.org/InStock" },
  "url": "https://www.davesmith.com/used/Toyota/2022-Toyota-Tacoma-ghi.htm"
}
</script>
</head><body></body></html>
`;

// ── Fixture 3: Dealer.com .vehicle-card DOM ────────────────────────────────
const CARD_HTML = `
<ul>
  <li class="vehicle-card" data-vin="1FTFW1E80NF400004" data-stock="NF400004">
    <a href="/used/Ford/2022-Ford-F-150-jkl.htm">
      <img src="https://pictures.dealer.com/d/davesmith/7001.jpg?impolicy=downsize&w=300&h=225" alt="">
      <h2 class="vehicle-card-title">2022 Ford F-150 Lariat 4WD</h2>
    </a>
    <div class="vehicle-card-details">28,410 miles</div>
    <div class="vehicle-card-pricing">Internet Price $46,750</div>
  </li>
</ul>
`;

describe('stripPhotoSizeParams', () => {
  it('drops impolicy/w/h and keeps the base URL', () => {
    expect(stripPhotoSizeParams('https://x.com/a.jpg?impolicy=downsize&w=520&h=390'))
      .toBe('https://x.com/a.jpg');
  });
  it('keeps unrelated query params', () => {
    expect(stripPhotoSizeParams('https://x.com/a.jpg?id=7&w=520')).toBe('https://x.com/a.jpg?id=7');
  });
});

describe('extractFromDataLayer (Dealer.com DDC)', () => {
  const out = extractFromDataLayer(DDC_VEHICLES, BASE);

  it('extracts both vehicles', () => {
    expect(out).toHaveLength(2);
  });

  it('maps the shared shape with mileage + photos + price', () => {
    const equinox = out[0];
    expect(equinox.vin).toBe('1GCPYBEK5RZ100001'); // uppercased
    expect(equinox.stock_number).toBe('RZ100001');
    expect(equinox.year).toBe(2026);
    expect(equinox.make).toBe('Chevrolet');
    expect(equinox.model).toBe('Equinox');
    expect(equinox.trim).toBe('RS All-Wheel Drive');
    expect(equinox.mileage).toBe(8966);
    // advertised finalPrice/askingPrice preferred over the higher internetPrice
    expect(equinox.price).toBe(34198);
    expect(equinox.photos).toEqual([
      'https://pictures.dealer.com/d/davesmith/0001.jpg',
      'https://pictures.dealer.com/d/davesmith/0002.jpg',
    ]);
    expect(equinox.vdp_url).toBe('https://www.davesmith.com/used/Chevrolet/2026-Chevrolet-Equinox-abc.htm');
    expect(equinox.source).toBe('scrape');
  });

  it('falls back to salePrice when internet/asking are zero', () => {
    expect(out[1].price).toBe(51995);
    expect(out[1].mileage).toBe(22140);
  });
});

describe('extractJsonLdVehicles (odometer + image extension)', () => {
  const out = extractJsonLdVehicles(JSONLD_HTML, BASE);

  it('extracts one vehicle with mileage from mileageFromOdometer.value', () => {
    expect(out).toHaveLength(1);
    const v = out[0];
    expect(v.vin).toBe('3TMCZ5AN9NM300003');
    expect(v.make).toBe('Toyota');
    expect(v.model).toBe('Tacoma');
    expect(v.year).toBe(2022);
    expect(v.mileage).toBe(41250);
    expect(v.price).toBe(38995);
  });

  it('extracts photos from both string and ImageObject forms, size-stripped', () => {
    expect(out[0].photos).toEqual([
      'https://pictures.dealer.com/d/davesmith/9001.jpg',
      'https://pictures.dealer.com/d/davesmith/9002.jpg',
    ]);
  });
});

describe('extractDomCards (.vehicle-card fallback)', () => {
  const doc = new DOMParser().parseFromString(CARD_HTML, 'text/html');
  const out = extractDomCards(doc, BASE);

  it('extracts the card into the shared shape', () => {
    expect(out).toHaveLength(1);
    const v = out[0];
    expect(v.vin).toBe('1FTFW1E80NF400004');
    expect(v.stock_number).toBe('NF400004');
    expect(v.year).toBe(2022);
    expect(v.make).toBe('Ford');
    expect(v.model).toBe('F-150');
    expect(v.mileage).toBe(28410);
    expect(v.price).toBe(46750);
    expect(v.photos[0]).toBe('https://pictures.dealer.com/d/davesmith/7001.jpg');
    expect(v.vdp_url).toBe('https://www.davesmith.com/used/Ford/2022-Ford-F-150-jkl.htm');
  });
});

describe('extractVehiclesFromPage (priority + dedupe)', () => {
  it('combines data layer + JSON-LD without duplicating', () => {
    const out = extractVehiclesFromPage({ dataLayer: DDC_VEHICLES, html: JSONLD_HTML, sourceUrl: BASE });
    // 2 DDC + 1 JSON-LD, none share a VIN → 3 distinct
    expect(out).toHaveLength(3);
    expect(out.every((v) => v.source === 'scrape')).toBe(true);
  });
});

describe('dedupeByVin (merge partials)', () => {
  it('merges a photo-less card into the DDC record by VIN', () => {
    const ddc = extractFromDataLayer([DDC_VEHICLES[0]], BASE);
    const partial = { ...ddc[0], photos: [], price: null, mileage: null };
    const merged = dedupeByVin([ddc[0], partial]);
    expect(merged).toHaveLength(1);
    expect(merged[0].photos.length).toBe(2);
    expect(merged[0].price).toBe(34198);
  });
});

describe('detectInventorySite', () => {
  it('detects when a platform data layer is present', () => {
    expect(detectInventorySite({ hasPlatformDataLayer: true, jsonLdVehicleCount: 0, vehicleCardCount: 0, url: 'https://x.com' })).toBe(true);
  });
  it('detects on >=3 vehicle cards', () => {
    expect(detectInventorySite({ hasPlatformDataLayer: false, jsonLdVehicleCount: 0, vehicleCardCount: 5, url: 'https://x.com' })).toBe(true);
  });
  it('detects on an /used-inventory URL', () => {
    expect(detectInventorySite({ hasPlatformDataLayer: false, jsonLdVehicleCount: 0, vehicleCardCount: 0, url: BASE })).toBe(true);
  });
  it('does not detect a plain page', () => {
    expect(detectInventorySite({ hasPlatformDataLayer: false, jsonLdVehicleCount: 0, vehicleCardCount: 0, url: 'https://www.davesmith.com/about.htm' })).toBe(false);
  });
});
