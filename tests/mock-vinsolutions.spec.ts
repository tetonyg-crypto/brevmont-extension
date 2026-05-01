/**
 * E2E Tests: Mock VinSolutions DOM — Brevmont Extension Surfaces
 *
 * Purpose: Verify the mock VinSolutions pages expose the exact DOM selectors the
 * Brevmont extension reads (customer data) and writes to (generated text injection).
 * These tests run against static HTML files via file:// — no server, no extension build.
 *
 * What is verified:
 *   - All selectors in window.BREVMONT_TEST_SELECTORS exist and are accessible
 *   - Customer data is populated and readable
 *   - Vehicle data is populated and readable
 *   - CRM note textarea is writable (extension injection surface)
 *   - Save-note flow works and fires mock:note-saved CustomEvent
 *   - Tab switching exposes email + SMS compose textareas
 *   - Leads list populates from MOCK_DATA with correct attributes
 *   - mock:note-saved CustomEvent detail matches saved text
 *
 * Run:
 *   npx playwright test tests/mock-vinsolutions.spec.ts
 */

import { test, expect } from '@playwright/test';
import path from 'path';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a local path to a file:// URL that works on both Windows and Unix.
 * Windows: C:\foo\bar → file:///C:/foo/bar
 * Unix:    /foo/bar   → file:///foo/bar
 */
function fileUrl(relativePath: string): string {
  const abs = path.resolve(__dirname, 'mock-vinsolutions', relativePath);
  const normalized = abs.replace(/\\/g, '/');
  // On Windows the path starts with a drive letter (C:/) — prepend triple slash.
  // On Unix it starts with / — prepend double slash (file:// + /foo = file:///foo).
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

const CUSTOMER_DETAIL = fileUrl('customer-detail.html');
const LEADS_LIST      = fileUrl('leads-list.html');
const INDEX_PAGE      = fileUrl('index.html');

// ── Suite: Customer Detail Page ──────────────────────────────────────────────

test.describe('customer-detail.html — DOM structure', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(CUSTOMER_DETAIL);
    // Wait until BREVMONT_TEST_SELECTORS is exposed by the inline script
    await page.waitForFunction(() => typeof (window as any).BREVMONT_TEST_SELECTORS === 'object');
  });

  test('window.BREVMONT_TEST_SELECTORS exposes all required selector keys', async ({ page }) => {
    const keys = await page.evaluate(() => Object.keys((window as any).BREVMONT_TEST_SELECTORS));
    expect(keys).toContain('crmNoteTextarea');
    expect(keys).toContain('emailBodyTextarea');
    expect(keys).toContain('smsBodyTextarea');
    expect(keys).toContain('customerName');
    expect(keys).toContain('vehicleTitle');
    expect(keys).toContain('vinNumber');
    expect(keys).toContain('vehiclePrice');
    expect(keys).toContain('injectPoint');
  });

  test('customer name element exists and contains expected value', async ({ page }) => {
    const el = page.locator('#customer-name');
    await expect(el).toBeVisible();
    await expect(el).toHaveText('Test Customer Alpha');
  });

  test('customer phone and email are present', async ({ page }) => {
    await expect(page.locator('#customer-phone')).toContainText('(307) 555-0100');
    await expect(page.locator('#customer-email')).toContainText('alpha@testcustomer.internal');
  });

  test('vehicle title element exists and contains year/make/model', async ({ page }) => {
    const el = page.locator('#vehicle-title');
    await expect(el).toBeVisible();
    await expect(el).toHaveText('2024 Ford F-150 XLT 4WD');
  });

  test('VIN element is present with correct value', async ({ page }) => {
    const vin = page.locator('#vin-number');
    await expect(vin).toBeVisible();
    await expect(vin).toHaveText('1FTFW1E87RFA00001');
  });

  test('stock number is present', async ({ page }) => {
    await expect(page.locator('#stock-number')).toHaveText('ST-2024-001');
  });

  test('vehicle price is present', async ({ page }) => {
    await expect(page.locator('#vehicle-price')).toHaveText('$52,850');
  });

  test('vehicle color is present', async ({ page }) => {
    await expect(page.locator('#vehicle-color')).toHaveText('Velocity Blue');
  });

  test('vehicle-of-interest card is present', async ({ page }) => {
    await expect(page.locator('#vehicle-of-interest')).toBeVisible();
  });

});

// ── Suite: CRM Note Textarea (Primary Extension Injection Target) ─────────────

test.describe('customer-detail.html — CRM note textarea', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(CUSTOMER_DETAIL);
    await page.waitForFunction(() => typeof (window as any).BREVMONT_TEST_SELECTORS === 'object');
  });

  test('#crm-note-input is visible and writable', async ({ page }) => {
    const ta = page.locator('#crm-note-input');
    await expect(ta).toBeVisible();
    await expect(ta).toBeEditable();
    await expect(ta).toHaveAttribute('data-role', 'crm-note');
    await expect(ta).toHaveAttribute('name', 'activity_note');
  });

  test('#crm-note-input class is vs-note-textarea (extension CSS hook)', async ({ page }) => {
    const cls = await page.locator('#crm-note-input').getAttribute('class');
    expect(cls).toContain('vs-note-textarea');
  });

  test('extension can write text into #crm-note-input', async ({ page }) => {
    const ta = page.locator('#crm-note-input');
    const injected = 'Hey Test Customer Alpha — just following up on the F-150 XLT!';
    // Simulate what the extension content script does: set value + dispatch input event
    await ta.evaluate((el: HTMLTextAreaElement, text) => {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, injected);
    await expect(ta).toHaveValue(injected);
  });

  test('Save Note button appends item to activity log and clears textarea', async ({ page }) => {
    const ta = page.locator('#crm-note-input');
    const noteText = 'E2E test note — mock save flow verification';

    await ta.fill(noteText);
    await page.locator('#save-note-btn').click();

    // Textarea should be cleared after save
    await expect(ta).toHaveValue('');

    // Activity log should now contain the note text
    const log = page.locator('#activity-log');
    await expect(log).toContainText(noteText);
  });

  test('mock:note-saved CustomEvent fires with correct detail.text', async ({ page }) => {
    const noteText = 'Playwright captured this note via CustomEvent';

    // Listen for the custom event before triggering it
    const eventDetail = page.evaluate<string>(() =>
      new Promise<string>(resolve => {
        document.addEventListener('mock:note-saved', (e: Event) => {
          resolve((e as CustomEvent).detail.text);
        }, { once: true });
      })
    );

    await page.locator('#crm-note-input').fill(noteText);
    await page.locator('#save-note-btn').click();

    const captured = await eventDetail;
    expect(captured).toBe(noteText);
  });

  test('Clear button empties the textarea', async ({ page }) => {
    const ta = page.locator('#crm-note-input');
    await ta.fill('Some text that should be cleared');
    await page.locator('#clear-note-btn').click();
    await expect(ta).toHaveValue('');
  });

  test('#brevmont-inject-point is present (extension UI anchor)', async ({ page }) => {
    const injectPoint = page.locator('#brevmont-inject-point');
    await expect(injectPoint).toBeVisible();
  });

});

// ── Suite: Tab Switching (Email + SMS surfaces) ───────────────────────────────

test.describe('customer-detail.html — tab switching', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(CUSTOMER_DETAIL);
    await page.waitForFunction(() => typeof (window as any).BREVMONT_TEST_SELECTORS === 'object');
  });

  test('Notes tab is active by default, crm-note-input visible', async ({ page }) => {
    await expect(page.locator('.vs-tab.active')).toHaveText(/Notes/);
    await expect(page.locator('#crm-note-input')).toBeVisible();
    await expect(page.locator('#email-body')).not.toBeVisible();
    await expect(page.locator('#sms-body')).not.toBeVisible();
  });

  test('Emails tab switch reveals #email-body textarea (data-role=email-compose)', async ({ page }) => {
    await page.locator('.vs-tab[data-tab="emails"]').click();

    const emailBody = page.locator('#email-body');
    await expect(emailBody).toBeVisible();
    await expect(emailBody).toHaveAttribute('data-role', 'email-compose');
    await expect(emailBody).toHaveAttribute('name', 'email_body');
    // crm textarea should be hidden (parent tab div hidden)
    await expect(page.locator('#crm-note-input')).not.toBeVisible();
  });

  test('email body textarea is writable (extension email injection surface)', async ({ page }) => {
    await page.locator('.vs-tab[data-tab="emails"]').click();
    const emailBody = page.locator('#email-body');
    const emailText = 'Subject: Following up on your F-150 XLT interest\n\nHi Test Customer Alpha,';
    await emailBody.fill(emailText);
    await expect(emailBody).toHaveValue(emailText);
  });

  test('Texts tab switch reveals #sms-body textarea (data-role=sms-compose)', async ({ page }) => {
    await page.locator('.vs-tab[data-tab="texts"]').click();

    const smsBody = page.locator('#sms-body');
    await expect(smsBody).toBeVisible();
    await expect(smsBody).toHaveAttribute('data-role', 'sms-compose');
    await expect(smsBody).toHaveAttribute('name', 'sms_body');
  });

  test('sms body textarea is writable (extension SMS injection surface)', async ({ page }) => {
    await page.locator('.vs-tab[data-tab="texts"]').click();
    const smsBody = page.locator('#sms-body');
    const smsText = 'Hey Alpha — still interested in the F-150? — Test Rep One';
    await smsBody.fill(smsText);
    await expect(smsBody).toHaveValue(smsText);
  });

  test('switching back to Notes tab re-shows crm-note-input', async ({ page }) => {
    // Go to emails
    await page.locator('.vs-tab[data-tab="emails"]').click();
    await expect(page.locator('#crm-note-input')).not.toBeVisible();

    // Back to notes
    await page.locator('.vs-tab[data-tab="notes"]').click();
    await expect(page.locator('#crm-note-input')).toBeVisible();
  });

});

// ── Suite: Leads List Page ────────────────────────────────────────────────────

test.describe('leads-list.html — DOM structure and data', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(LEADS_LIST);
    // Wait for leads to be injected by data.js
    await page.waitForSelector('#leads-tbody tr');
  });

  test('leads table renders 3 rows from MOCK_DATA', async ({ page }) => {
    const rows = page.locator('#leads-tbody tr');
    await expect(rows).toHaveCount(3);
  });

  test('first lead row is Test Customer Alpha with F-150', async ({ page }) => {
    const firstRow = page.locator('#leads-tbody tr').first();
    await expect(firstRow).toContainText('Test Customer Alpha');
    await expect(firstRow).toContainText('2024 Ford F-150 XLT 4WD');
    await expect(firstRow).toContainText('Hot');
  });

  test('lead rows have correct data-lead-id attributes', async ({ page }) => {
    const rows = page.locator('#leads-tbody tr');
    await expect(rows.nth(0)).toHaveAttribute('data-lead-id', 'L001');
    await expect(rows.nth(1)).toHaveAttribute('data-lead-id', 'L002');
    await expect(rows.nth(2)).toHaveAttribute('data-lead-id', 'L003');
  });

  test('lead rows have data-customer-name attributes', async ({ page }) => {
    const rows = page.locator('#leads-tbody tr');
    await expect(rows.nth(0)).toHaveAttribute('data-customer-name', 'Test Customer Alpha');
    await expect(rows.nth(1)).toHaveAttribute('data-customer-name', 'Test Customer Beta');
    await expect(rows.nth(2)).toHaveAttribute('data-customer-name', 'Test Customer Gamma');
  });

  test('lead rows have data-vehicle attributes', async ({ page }) => {
    const rows = page.locator('#leads-tbody tr');
    await expect(rows.nth(0)).toHaveAttribute('data-vehicle', '2024 Ford F-150 XLT 4WD');
    await expect(rows.nth(1)).toHaveAttribute('data-vehicle', '2023 Toyota Tacoma TRD Off-Road');
    await expect(rows.nth(2)).toHaveAttribute('data-vehicle', '2024 Chevrolet Silverado 1500 LT');
  });

  test('status badges render correct classes', async ({ page }) => {
    const badges = page.locator('#leads-tbody .badge');
    await expect(badges.first()).toHaveClass(/badge-hot/);
    await expect(badges.nth(1)).toHaveClass(/badge-working/);
    await expect(badges.nth(2)).toHaveClass(/badge-cold/);
  });

  test('clicking a lead row adds selected class', async ({ page }) => {
    const firstRow = page.locator('#leads-tbody tr').first();
    await firstRow.click();
    await expect(firstRow).toHaveClass(/selected/);
  });

  test('lead name links to customer-detail.html', async ({ page }) => {
    const link = page.locator('#leads-tbody tr').first().locator('a');
    await expect(link).toHaveAttribute('href', 'customer-detail.html');
  });

});

// ── Suite: Index / Harness Page ───────────────────────────────────────────────

test.describe('index.html — test harness landing page', () => {

  test('index page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(INDEX_PAGE);
    await page.waitForLoadState('domcontentloaded');
    expect(errors).toHaveLength(0);
  });

  test('mock banner is visible', async ({ page }) => {
    await page.goto(INDEX_PAGE);
    await expect(page.locator('.mock-banner')).toBeVisible();
    await expect(page.locator('.mock-banner')).toContainText('TEST HARNESS');
  });

  test('links to leads-list.html and customer-detail.html are present', async ({ page }) => {
    await page.goto(INDEX_PAGE);
    await expect(page.locator('a[href="leads-list.html"]').first()).toBeVisible();
    await expect(page.locator('a[href="customer-detail.html"]').first()).toBeVisible();
  });

});

// ── Suite: MOCK_DATA consistency ─────────────────────────────────────────────

test.describe('data.js — window.MOCK_DATA shape', () => {

  test('MOCK_DATA.leads has 3 entries with required fields', async ({ page }) => {
    await page.goto(CUSTOMER_DETAIL);
    const leads = await page.evaluate(() => (window as any).MOCK_DATA?.leads);
    expect(Array.isArray(leads)).toBe(true);
    expect(leads).toHaveLength(3);
    for (const lead of leads) {
      expect(lead).toHaveProperty('id');
      expect(lead).toHaveProperty('name');
      expect(lead).toHaveProperty('phone');
      expect(lead).toHaveProperty('vehicle');
      expect(lead).toHaveProperty('status');
    }
  });

  test('MOCK_DATA.currentCustomer has VIN, price, and make', async ({ page }) => {
    await page.goto(CUSTOMER_DETAIL);
    const customer = await page.evaluate(() => (window as any).MOCK_DATA?.currentCustomer);
    expect(customer).toHaveProperty('vin', '1FTFW1E87RFA00001');
    expect(customer).toHaveProperty('price', '$52,850');
    expect(customer).toHaveProperty('make', 'Ford');
    expect(customer).toHaveProperty('model', 'F-150');
    expect(customer).toHaveProperty('year', '2024');
  });

});
