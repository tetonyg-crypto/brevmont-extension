import { afterEach, describe, expect, test } from 'vitest';
import { cargurusAdapter } from '../../entrypoints/lib/platforms/cargurus';
import { carsdotcomAdapter } from '../../entrypoints/lib/platforms/carsdotcom';
import { autotraderAdapter } from '../../entrypoints/lib/platforms/autotrader';

// 2026-09-26 audit: the CarGurus / Cars.com / AutoTrader stub adapters match
// whole domains, so on a public listing page they sent the last 2000 chars
// of the page as the "customer message" and the listing H1 as the customer.

function setUrl(url: string) {
  (window as any).happyDOM.setURL(url);
}

const LISTING = `<h1>2021 Chevrolet Tahoe LT</h1><main><p>Great price. 32,000 miles. Contact dealer.</p></main>`;

describe('marketplace stubs on public listing pages', () => {
  afterEach(() => { setUrl('about:blank'); document.body.innerHTML = ''; });

  const cases: Array<[string, any, string, string]> = [
    ['CarGurus', cargurusAdapter, 'https://www.cargurus.com/Cars/inventorylisting/viewDetailsFilterViewInventoryListing.action', 'https://dealer.cargurus.com/inbox'],
    ['Cars.com', carsdotcomAdapter, 'https://www.cars.com/vehicledetail/abc123/', 'https://dealers.cars.com/messages'],
    ['AutoTrader', autotraderAdapter, 'https://www.autotrader.com/cars-for-sale/vehicle/123', 'https://dealer.autotrader.com/leads'],
  ];

  for (const [label, adapter, publicUrl, dealerUrl] of cases) {
    test(`${label}: public listing yields no customer and no last inbound`, () => {
      setUrl(publicUrl);
      document.body.innerHTML = LISTING;
      expect(adapter.hostMatches(publicUrl)).toBe(true);
      expect(adapter.extractCustomer().name).toBeNull();
      expect(adapter.scrapeThread().last_inbound_text).toBe('');
    });

    test(`${label}: dealer host keeps the existing stub behaviour`, () => {
      setUrl(dealerUrl);
      document.body.innerHTML = `<h1>Jennifer Ramirez</h1><main><p>Is it still available?</p></main>`;
      expect(adapter.extractCustomer().name).toBe('Jennifer Ramirez');
      expect(adapter.scrapeThread().last_inbound_text).toContain('Is it still available?');
    });
  }
});
