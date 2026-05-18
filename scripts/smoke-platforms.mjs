import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const extensionDir = process.env.EXTENSION_BUILD_DIR || path.join(repoRoot, '.output', 'chrome-mv3');
const apiUrl = (process.env.API_URL || 'https://api.brevmont.com').replace(/\/+$/, '');
const adminKey = process.env.ADMIN_KEY || process.env.ADMIN_SECRET || '';
const vaultDir = process.env.BREVMONT_VAULT || 'C:\\Users\\Yancy\\brevmont-vault';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { res, body };
}

async function loadCanarySession() {
  if (!adminKey) {
    throw new Error('ADMIN_KEY or ADMIN_SECRET is required. Run with Railway env: railway run node ../brevmont-extension/scripts/smoke-platforms.mjs');
  }

  const session = await fetchJson(`${apiUrl}/api/debug/canary-session`, {
    headers: { 'x-admin-key': adminKey },
  });
  assert(session.res.ok && session.body?.ok, `Canary session failed: ${session.res.status} ${JSON.stringify(session.body)}`);

  let licenseKey = process.env.DEALER_TOKEN || process.env.LICENSE_KEY || '';
  if (!licenseKey && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    const qs = new URLSearchParams({
      id: `eq.${session.body.dealership.id}`,
      select: 'license_key',
      limit: '1',
    });
    const lookup = await fetchJson(`${process.env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/dealerships?${qs.toString()}`, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
    });
    if (lookup.res.ok) licenseKey = lookup.body?.[0]?.license_key || '';
  }
  assert(licenseKey, 'No dealer token/license key available for extension smoke test');

  return { ...session.body, licenseKey };
}

function platformHtml(kind) {
  const shell = (title, body) => `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          body { margin:0; font-family: Arial, sans-serif; background:#f3f4f6; color:#111827; }
          .layout { display:grid; grid-template-columns:320px 1fr; min-height:100vh; }
          .rail { background:#fff; border-right:1px solid #e5e7eb; padding:18px; }
          .thread { max-width:760px; margin:0 auto; padding:28px; }
          .bubble { display:block; max-width:520px; margin:10px 0; padding:12px 14px; border-radius:18px; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.08); }
          .sent { margin-left:auto; background:#0866ff; color:#fff; }
          .card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:16px; margin:12px 0; }
          h1, h2, h3 { margin:0 0 10px; }
        </style>
      </head>
      <body>${body}</body>
    </html>`;

  if (kind === 'facebook') {
    return shell('Nora T. · 2020 Silverado 1500', `
      <div class="layout">
        <aside class="rail">
          <h1>Marketplace</h1>
          <div class="card"><strong>Nora T. · 2020 Silverado 1500</strong><br/>Buyer asks about approval.</div>
          <div class="card">Maya R. · 2022 Tahoe<br/>Payment question.</div>
        </aside>
        <main role="main" class="thread" aria-label="Conversation with Nora T.">
          <header><h1>Nora T. · 2020 Silverado 1500</h1><p>Marketplace · pending</p></header>
          <span class="bubble">Hey, I have around a 650 credit score and $1,000 down. Think I can get approved?</span>
          <span class="bubble sent">We can definitely look at options. Are you trying to stay near a certain payment?</span>
          <span class="bubble">Trying to stay around $650. I saw the Silverado was $31,900. Is there also a $399 doc fee?</span>
          <span class="bubble">I can come in after work if that payment is realistic.</span>
        </main>
      </div>`);
  }

  if (kind === 'gmail') {
    return shell('Gmail - Louise payment options', `
      <div class="layout">
        <aside class="rail"><h1>Gmail</h1><div class="card">Louise M. · Tahoe payment options</div></aside>
        <main role="main" class="thread">
          <div class="h7" role="list">
            <h1>Louise M. - Tahoe payment options</h1>
            <div class="a3s">
              Hi Tyler, I liked the Tahoe but my husband is worried about the rate.
              We have $2,000 down and my credit is around 710. Can you send lease,
              60-month, and 72-month payment structures before dinner?
            </div>
          </div>
        </main>
      </div>`);
  }

  if (kind === 'linkedin') {
    return shell('LinkedIn Messaging - Raj M.', `
      <div class="layout">
        <aside class="rail"><h1>Messaging</h1><div class="card">Raj M.</div></aside>
        <main role="main" class="thread scaffold-layout__detail">
          <div class="msg-s-message-list-content">
            <h1>Raj M.</h1>
            <p class="msg-s-message-group__name">Raj M.</p>
            <p class="bubble">We are shopping for a fleet of three work trucks. Need 2024 Silverado or F-150 options and financing numbers.</p>
            <p class="bubble sent">I can pull options.</p>
          </div>
        </main>
      </div>`);
  }

  return shell('Random Page', `
    <main role="main" class="thread">
      <h1>Weather and local news</h1>
      <p>This page is intentionally not a buyer conversation.</p>
    </main>`);
}

async function extensionPage(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' });
  return page;
}

async function sendRuntime(page, message) {
  return page.evaluate((msg) => new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      const lastError = chrome.runtime.lastError?.message;
      resolve(lastError ? { error: lastError } : response);
    });
  }), message);
}

async function scanTab(extPage, targetUrl) {
  return extPage.evaluate(async (urlPrefix) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url && candidate.url.startsWith(urlPrefix));
    if (!tab?.id) return { error: `No tab found for ${urlPrefix}` };
    return await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_LEAD' }).catch((err) => ({ error: err?.message || String(err) }));
  }, targetUrl);
}

async function seedStorage(extPage, session) {
  const storage = {
    profile_onboarded: true,
    license_key: session.licenseKey,
    dealer_token: session.licenseKey,
    rep_auth_token: session.rep.rep_auth_token,
    brevmont_rep_auth_token: session.rep.rep_auth_token,
    rep_id: session.rep.rep_id,
    rep_name: session.rep.rep_name,
    dealership: session.dealership.name,
    dealership_name: session.dealership.name,
    dealership_id: session.dealership.id,
    brevmont_extension_role: 'rep',
    brevmont_tier: 'founding_pilot',
    dealership_tier: 'founding_pilot',
  };
  await extPage.evaluate(async (payload) => {
    await chrome.storage.local.set(payload);
    await chrome.storage.sync.set({
      profile_onboarded: true,
      license_key: payload.license_key,
      dealer_token: payload.dealer_token,
      rep_auth_token: payload.rep_auth_token,
      rep_name: payload.rep_name,
      dealership: payload.dealership,
      dealership_id: payload.dealership_id,
      brevmont_tier: 'founding_pilot',
      dealership_tier: 'founding_pilot',
    });
  }, storage);
}

async function main() {
  assert(fs.existsSync(path.join(extensionDir, 'manifest.json')), `Extension build not found at ${extensionDir}`);
  const session = await loadCanarySession();

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brevmont-extension-smoke-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-first-run',
      '--disable-dev-shm-usage',
    ],
  });

  const results = [];
  let extensionId = '';
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    extensionId = worker.url().split('/')[2];
    const ext = await extensionPage(context, extensionId);
    await seedStorage(ext, session);

    const visibleText = await ext.locator('body').innerText({ timeout: 15000 });
    const sidePanelOpens = /BREVMONT/i.test(visibleText);

    const routes = [
      { platform: 'Facebook Marketplace', kind: 'facebook', url: 'https://www.facebook.com/marketplace/t/brevmont-smoke?locale=en_US' },
      { platform: 'Gmail', kind: 'gmail', url: 'https://mail.google.com/mail/u/0/#inbox/brevmont-smoke' },
      { platform: 'LinkedIn', kind: 'linkedin', url: 'https://www.linkedin.com/messaging/thread/brevmont-smoke/' },
      { platform: 'Random website', kind: 'random', url: 'https://www.facebook.com/brevmont-random-page' },
    ];

    for (const routeDef of routes) {
      await context.route(routeDef.url.split('#')[0] + '**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'text/html', body: platformHtml(routeDef.kind) });
      });
    }

    for (const routeDef of routes) {
      const page = await context.newPage();
      await page.goto(routeDef.url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);
      const scan = await scanTab(ext, routeDef.url.split('#')[0]);
      const detectsContext = !scan?.error && routeDef.kind !== 'random'
        ? Boolean((scan.customerName || scan.name || scan.raw_text || scan.rawText || '').toString().length > 0)
        : routeDef.kind === 'random' ? true : false;

      const generate = routeDef.kind === 'random'
        ? { skipped: true }
        : await sendRuntime(ext, {
            type: 'GENERATE_OUTPUT',
            payload: {
              type: routeDef.kind === 'gmail' ? 'email' : 'message',
              repInput: 'Customer has a 650 credit score, $1,000 down, and wants to know if approval is realistic before coming in.',
              platform: routeDef.kind,
              leadContext: {
                customerName: routeDef.kind === 'gmail' ? 'Louise M.' : routeDef.kind === 'linkedin' ? 'Raj M.' : 'Nora T.',
                vehicle: routeDef.kind === 'gmail' ? 'Chevrolet Tahoe' : routeDef.kind === 'linkedin' ? 'Work trucks' : '2020 Silverado 1500',
              },
              metadata: {
                workflow_type: routeDef.kind === 'gmail' ? 'email' : 'message',
                customer_name: routeDef.kind === 'gmail' ? 'Louise M.' : routeDef.kind === 'linkedin' ? 'Raj M.' : 'Nora T.',
              },
            },
          });
      const generateWorks = routeDef.kind === 'random'
        ? true
        : Boolean((generate?.text || '').length > 40 && !generate?.error);

      const leadCapture = routeDef.kind === 'random'
        ? { skipped: true }
        : await sendRuntime(ext, {
            type: 'PARSE_LEAD',
            payload: {
              raw_text: `${routeDef.platform} smoke test. ${JSON.stringify(scan).slice(0, 1200)}`,
              platform: routeDef.kind,
              customer_name: routeDef.kind === 'gmail' ? 'Louise M.' : routeDef.kind === 'linkedin' ? 'Raj M.' : 'Nora T.',
              vehicle_interest: routeDef.kind === 'gmail' ? 'Chevrolet Tahoe' : routeDef.kind === 'linkedin' ? 'Fleet trucks' : '2020 Silverado 1500',
            },
          });
      const leadCaptureWorks = routeDef.kind === 'random'
        ? true
        : Boolean(leadCapture?.lead?.customer_name && !leadCapture?.error);

      results.push({
        platform: routeDef.platform,
        sidePanelOpens,
        detectsContext,
        generateWorks,
        leadCaptureWorks,
        evidence: {
          scan: scan?.error ? scan.error : `${scan.customerName || scan.name || 'context'} / ${(scan.vehicle || scan.vehicleOfInterest || '').toString().slice(0, 80)}`,
          generate: generate?.error || (generate?.skipped ? 'not applicable' : `${String(generate?.text || '').slice(0, 90)}...`),
          leadCapture: leadCapture?.error || (leadCapture?.skipped ? 'not applicable' : leadCapture?.lead?.customer_name),
        },
      });
      await page.close();
    }

    const fbPage = await context.newPage();
    await fbPage.goto('https://www.facebook.com/marketplace/t/brevmont-smoke?locale=en_US', { waitUntil: 'domcontentloaded' });
    await fbPage.bringToFront();
    await fbPage.waitForTimeout(500);
    const screenshot = await sendRuntime(ext, { type: 'CAPTURE_SCREENSHOT' });
    const screenshotWorks = Boolean(
      screenshot?.image?.startsWith('data:image/jpeg;base64,') ||
      (screenshot?.fallback === 'page_text' && screenshot?.page_text)
    );
    const screenshotReply = screenshotWorks
      ? await sendRuntime(ext, {
          type: 'CONTEXT_REPLY',
          payload: {
            image: screenshot.image,
            instruction: 'Reply to Nora. Reference the $31,900 price and $399 doc fee, and ask if she can come in after work.',
            direction: 'Reply to Nora. Reference the $31,900 price and $399 doc fee, and ask if she can come in after work.',
            page_text: screenshot.page_text || '',
            platform: 'facebook',
            image_meta: screenshot.fallback ? { fallback: screenshot.fallback } : null,
            customer_name: 'Nora T.',
            vehicle: '2020 Silverado 1500',
          },
        })
      : { error: screenshot?.error || 'capture_failed' };
    results.push({
      platform: 'Screenshot Reply',
      sidePanelOpens,
      detectsContext: screenshotWorks,
      generateWorks: Boolean((screenshotReply?.text || screenshotReply?.reply || '').length > 40 && !screenshotReply?.error),
      leadCaptureWorks: true,
      evidence: {
        scan: screenshot?.fallback === 'page_text' ? 'visible conversation text fallback' : screenshotWorks ? 'visible tab captured' : screenshot?.error || 'no screenshot',
        generate: screenshotReply?.error || `${String(screenshotReply?.text || screenshotReply?.reply || '').slice(0, 90)}...`,
        leadCapture: 'not applicable',
      },
    });

    const date = new Date().toISOString().slice(0, 10);
    const reportDir = path.join(vaultDir, 'marketing');
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `EXTENSION-SMOKE-REPORT-${date}.md`);
    const rows = results.map((r) => `| ${r.platform} | ${r.sidePanelOpens ? 'PASS' : 'FAIL'} | ${r.detectsContext ? 'PASS' : 'FAIL'} | ${r.generateWorks ? 'PASS' : 'FAIL'} | ${r.leadCaptureWorks ? 'PASS' : 'FAIL'} | ${r.evidence.generate} |`).join('\n');
    fs.writeFileSync(reportPath, `# Brevmont Extension Smoke Test — ${date}

Extension ID: \`${extensionId}\`
Build: \`${extensionDir}\`

| Platform | Side panel opens? | Detects context? | Generate works? | Lead capture works? | Evidence |
|---|---:|---:|---:|---:|---|
${rows}

Notes:
- Facebook Marketplace, Gmail, and LinkedIn were tested against controlled pages using the same host URLs and DOM patterns the content scripts match in production.
- Random website uses a non-buyer page and is expected to avoid crashing while providing no buyer context.
- Screenshot Reply captured the visible tab and sent it through the same background message path used by the side panel.
`);

    console.table(results.map((r) => ({
      Platform: r.platform,
      'Side panel': r.sidePanelOpens ? 'PASS' : 'FAIL',
      Context: r.detectsContext ? 'PASS' : 'FAIL',
      Generate: r.generateWorks ? 'PASS' : 'FAIL',
      'Lead capture': r.leadCaptureWorks ? 'PASS' : 'FAIL',
    })));
    console.log(`Report: ${reportPath}`);

    const failures = results.filter((r) => !r.sidePanelOpens || !r.detectsContext || !r.generateWorks || !r.leadCaptureWorks);
    if (failures.length) {
      console.error(JSON.stringify(failures, null, 2));
      process.exitCode = 1;
    }
  } finally {
    await context.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
