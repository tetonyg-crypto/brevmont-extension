import { describe, expect, test } from 'vitest';
import { extractFromDataLayer } from '../../entrypoints/lib/inventory/scrape';

// REAL data captured live from Dave Smith Motors (Dealer.com) DDC.dataLayer
const REAL = [
  { vin:'3GNAXTEG4TL249326', stockNumber:'TTL249326', year:2026, modelYear:2026, make:'Chevrolet', model:'Equinox', trim:'RS', bodyStyle:'SUV', odometer:8966, newOrUsed:'used',
    pricing:{ askingPrice:'$34,198', finalPrice:'$34,198', internetPrice:'$35,908' }, askingPrice:'$34,198', internetPrice:'$35,908',
    link:'/certified/Chevrolet/2026-Chevrolet-Equinox-88480d90ac181b1b4ac2fb7fd772b7c6.htm',
    images:[{ alt:'2026 Chevrolet Equinox RS SUV', uri:'https://pictures.dealer.com/d/davesmithmotors/1702/eba1f2b87a434f002f864d440b03fe6fx.jpg' }] },
  { vin:'1GC4KTEY7TF300132', stockNumber:'TTF300132', year:2026, modelYear:2026, make:'Chevrolet', model:'Silverado 3500', trim:'LT', odometer:2304, newOrUsed:'used',
    pricing:{ askingPrice:'$72,998', finalPrice:'$72,998', internetPrice:'$76,648' }, askingPrice:'$72,998', internetPrice:'$76,648',
    link:'/used/Chevrolet/2026-Chevrolet-Silverado-3500-84a12c5eac1804b19b597a95e83d8eb0.htm',
    images:[{ uri:'https://pictures.dealer.com/d/davesmithmotors/0841/778f4c3e3c1f9a6052fbe2febdd7f00ex.jpg' }] },
];

describe('REAL Dealer.com data — advertised (asking/final) price, not internetPrice', () => {
  test('Equinox 34198 (not 35908), Silverado 72998 (not 76648)', () => {
    const out = extractFromDataLayer(REAL, 'https://www.davesmith.com');
    const eq = out.find(v => v.vin === '3GNAXTEG4TL249326');
    const sil = out.find(v => v.vin === '1GC4KTEY7TF300132');
    expect(eq?.price).toBe(34198);
    expect(sil?.price).toBe(72998);
    expect(eq?.mileage).toBe(8966);
    expect(eq?.vdp_url).toContain('davesmith.com');
    expect((eq?.photos || []).length).toBeGreaterThan(0);
  });
});
