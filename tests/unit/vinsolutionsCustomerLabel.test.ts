import { beforeEach, describe, expect, test } from 'vitest';
import { vinsolutionsAdapter } from '../../entrypoints/lib/platforms/vinsolutions';

// 2026-09-26 audit: `Customer\s*:?\s+Name` matched a "Customer Dashboard"
// nav link and returned "Dashboard Leads Jennifer Ramirez Sales" at 0.9.

describe('VinSolutions customer name', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('nav text "Customer Dashboard Leads ..." is not a customer label', () => {
    document.body.innerHTML = `<nav>Customer Dashboard Leads Jennifer Ramirez Sales</nav><main><p>Nothing here</p></main>`;
    expect(vinsolutionsAdapter.extractCustomer().name).toBeNull();
  });

  test('a real "Customer:" label in the customer panel wins over nav chrome', () => {
    document.body.innerHTML = `<nav>Customer Dashboard Leads Sales</nav>
      <div class="vs-customer-header"><div>Customer: Jennifer Ramirez</div><div>(307) 555-0100</div></div>`;
    const c = vinsolutionsAdapter.extractCustomer();
    expect(c.name).toBe('Jennifer Ramirez');
    expect(c.raw_source).toBe('vin_customer_label');
  });

  test('an H1 that is page chrome is rejected', () => {
    document.body.innerHTML = `<h1>Customer Dashboard</h1>`;
    expect(vinsolutionsAdapter.extractCustomer().name).toBeNull();
  });
});
