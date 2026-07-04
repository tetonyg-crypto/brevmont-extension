import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

test('manual Generate auto-scans the active thread before using typed fallback', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  expect(source).toContain('startAutoThreadScan(root)');
  expect(source).toContain("sendToContent({ type: 'SCAN_LEAD_V2' })");
  expect(source).toContain("ctx = await sendToContent({ type: 'SCAN_LEAD' })");
  expect(source).toContain('threadContext: scan?.threadContext || null');
  expect(source).toContain('repInput: input');
  expect(source).toContain('zero_context_generate: !!scan');
  expect(source).toContain('Replying to:');
});

test('manual Generate reads output chips after forced scan applies surface defaults', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  const start = source.indexOf('async function doGenerate');
  const body = source.slice(start, source.indexOf('// ─── Add output card', start));
  expect(body.indexOf('scan = await scanThreadForGenerate(root, true)')).toBeGreaterThan(-1);
  expect(body.indexOf("root.querySelectorAll('.chip.on')")).toBeGreaterThan(
    body.indexOf('scan = await scanThreadForGenerate(root, true)'),
  );
  expect(body.indexOf("const type = selected.length === 3 ? 'all'")).toBeGreaterThan(
    body.indexOf("root.querySelectorAll('.chip.on')"),
  );
});

test('output chips are exclusive mode selectors before generation', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  const ui = read('entrypoints/lib/panelUI.ts');
  expect(source).not.toContain("c.classList.toggle('on')");
  expect(source).toContain('function selectOutputChip');
  expect(source).toContain('const selectedType = selectOutputChip(root');
  expect(source).toContain('setActiveOutputTab(root, selectedType)');
  expect(ui).toContain('<button class="chip on" data-type="text">Message</button>');
  expect(ui).toContain('<button class="chip" data-type="email">Email</button>');
  expect(ui).toContain('<button class="chip" data-type="crm">CRM Note</button>');
});

test('output chips keep next-generate selection after output cards exist', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  const start = source.indexOf('// Output chips');
  const chipHandler = source.slice(start, source.indexOf('// Generate button', start));
  expect(chipHandler).toContain('const selectedType = selectOutputChip(root');
  expect(chipHandler).toContain('const hasMatchingCard');
  expect(chipHandler).not.toContain('const hasCards');
});

test('Screenshot Reply is folded out of the visible tools UI', () => {
  const ui = read('entrypoints/lib/panelUI.ts');
  const source = read('entrypoints/sidepanel/main.ts');
  expect(ui).not.toContain('data-tool="context"');
  expect(ui).not.toContain('id="tool-context"');
  expect(ui).not.toContain('Screenshot Reply');
  expect(source).toContain('scanVisibleTextFallback(root)');
  expect(source).toContain("adapter_id: 'visible-text-fallback'");
});

test('Settings owns a scroll body with Overdrive mounted inside it', () => {
  const ui = read('entrypoints/lib/panelUI.ts');
  const css = read('entrypoints/lib/panelCSS.ts');
  const source = read('entrypoints/sidepanel/main.ts');
  expect(ui).toContain('id="o8-settings-scroll"');
  expect(ui).toContain('id="overdrive-panel-mount"');
  expect(ui.indexOf('id="sp-rep-first-name"')).toBeLessThan(ui.indexOf('id="overdrive-panel-mount"'));
  expect(ui).toContain('id="sp-settings-sign-out"');
  expect(css).toContain('.settings-scroll');
  expect(source).toContain("settingsPanel.querySelector('#overdrive-panel-mount')");
  expect(source).toContain("settingsPanelForDot.style.display = 'flex'");
  expect(source).toContain('scrollBody.scrollTop = 0');
});

test('sign-out blocks cookie-only re-adoption until app bridge handoff', () => {
  const background = read('entrypoints/background.ts');
  const sidepanel = read('entrypoints/sidepanel/main.ts');
  expect(background).toContain("SIGNED_OUT_SENTINEL_KEY = 'brevmont_signed_out_at'");
  expect(background).toContain('FRESH_SIGN_IN_INTENTS');
  expect(background).toContain('try_cookie_share_signed_out_blocked');
  expect(background).toContain('session_ready_signed_out_blocked');
  expect(background).toContain('explicit sign-out sentinel present');
  expect(background).toContain('browser.storage.local.remove(SIGNED_OUT_SENTINEL_KEY)');
  expect(sidepanel).toContain("SIGNED_OUT_SENTINEL_KEY = 'brevmont_signed_out_at'");
  expect(sidepanel).toContain('openAuthExtensionTab();');
  expect(sidepanel).toContain("`${AUTH_APP_URL}?force=1`");
});

test('My Leads merges server rows with local radar cache', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  expect(source).toContain("safeSend({ type: 'GET_MY_LEADS'");
  expect(source).toContain("safeSend({ type: 'GET_LOCAL_LEADS' })");
  expect(source).toContain('mergeLeadInboxRows(remoteLeads, localLeads, leadFilter)');
  expect(source).toContain('local_only');
});

test('Overdrive header dot paints from the same state as the pill', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  const css = read('entrypoints/lib/panelCSS.ts');
  expect(source).toContain("root.querySelector('#o8-account-btn')");
  expect(source).toContain('paintHeaderDot');
  expect(source).toContain('Overdrive solo test mode on');
  expect(source).toContain('Overdrive on and armed');
  expect(css).toContain('.account-btn.overdrive-dot-on');
  expect(css).toContain('.account-btn.overdrive-dot-on::after');
  expect(css).toContain('.account-btn.overdrive-dot-solo');
});

test('manual customer picker selection wins over auto-detection until thread changes', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  const start = source.indexOf('async function refreshCustomerDetection');
  const body = source.slice(start, source.indexOf('function startCustomerDetection', start));
  expect(body).toContain('if (isManualCustomerOverride(pinnedCustomer))');
  expect(body.indexOf('if (isManualCustomerOverride(pinnedCustomer))')).toBeLessThan(body.indexOf('if (confidence >= 0.8)'));
});

test('Ask Anything input handles Enter locally without falling into Generate', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  const start = source.indexOf('const cmdInput = el');
  const commandWire = source.slice(start, source.indexOf('// Lead capture panel', start));
  expect(commandWire).toContain('e.stopPropagation()');
  expect(commandWire).toContain('void doCommand(root)');
  expect(commandWire).not.toContain('doGenerate(root)');
});

test('manual Inject button uses the verified content-script bridge', () => {
  const sidepanel = read('entrypoints/sidepanel/main.ts');
  const content = read('entrypoints/content.ts');
  const start = sidepanel.indexOf('// Inject — send to content script');
  const injectWire = sidepanel.slice(start, sidepanel.indexOf('// Regen', start));
  expect(injectWire).toContain("type: 'INJECT_CONTENT_V2'");
  expect(injectWire).toContain('payload: { text: ta.value, kind: injectKindForOutputType(outputType)');
  expect(injectWire).toContain('resp.verified === false');
  expect(injectWire).not.toContain("type: 'INJECT_CONTENT',");
  expect(content).toContain('const duplicateVerify = await platforms.verifyInject(composer, text');
  expect(content).toContain('ok: verify.verified');
});

test('honest event platform names stay aligned with adapter surfaces', () => {
  const sidepanel = read('entrypoints/sidepanel/main.ts');
  const honest = read('entrypoints/lib/honestEvents.ts');
  for (const platform of [
    'outlook',
    'instagram',
    'whatsapp',
    'google-messages',
    'cargurus',
    'carsdotcom',
    'autotrader',
    'dealersocket',
    'elead',
  ]) {
    expect(sidepanel).toContain(`platform === '${platform}'`);
    expect(honest).toContain(`| '${platform}'`);
  }
  const normalizeStart = sidepanel.indexOf('function normalizeEventPlatform');
  const normalizeBody = sidepanel.slice(normalizeStart, sidepanel.indexOf('function normalizeOutputType', normalizeStart));
  expect(normalizeBody).toContain("return 'google-messages'");
  expect(normalizeBody).not.toContain('google_messages');
});

test('Gmail auto-scan does not invent last inbound from outbound or raw text fallback', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  expect(source).toContain("const isDeterministicGmailThread = (ctx.platform || currentPlatform.platform) === 'gmail' && messages.length > 0");
  expect(source).toContain("(isDeterministicGmailThread ? '' : messages[messages.length - 1]?.text)");
  expect(source).toContain("(isDeterministicGmailThread ? '' : lastReadableThreadLine(rawText))");
});

test('auto-scan keeps the textbox as optional steer and preserves honest fallback', () => {
  const ui = read('entrypoints/lib/panelUI.ts');
  const css = read('entrypoints/lib/panelCSS.ts');
  expect(ui).toContain('Optional: steer it');
  expect(ui).toContain('id="o8-reply-context"');
  expect(ui).toContain('Open a conversation and tap Generate.');
  expect(css).toContain('.reply-context-ready');
  expect(css).toContain('.reply-context-fallback');
});

test('background prompt uses scanned thread as primary context plus optional rep steer', () => {
  const source = read('entrypoints/background.ts');
  expect(source).toContain('SCANNED THREAD CONTEXT');
  expect(source).toContain('LAST CUSTOMER MESSAGE');
  expect(source).toContain('REP STEER / OPTIONAL DIRECTION');
  expect(source).toContain('Use the scanned thread as the primary source of truth');
  expect(source).toContain('systemHints?: { noVehicleDetected?: boolean }');
});

test('Outlook adapter is registered and allowed by manifest/content script', () => {
  expect(existsSync(resolve(process.cwd(), 'entrypoints/lib/platforms/outlook.ts'))).toBe(true);
  const registry = read('entrypoints/lib/platforms/registry.ts');
  const content = read('entrypoints/content.ts');
  const config = read('wxt.config.ts');
  expect(registry).toContain("outlook: () => import('./outlook')");
  expect(registry).toContain("return 'outlook'");
  expect(content).toContain('*://outlook.office.com/*');
  expect(config).toContain('*://outlook.office.com/*');
});

test('sidepanel connection gate includes every adapter surface used for zero-context scan', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  for (const host of [
    'messages.google.com',
    'cargurus.com',
    'cars.com',
    'autotrader.com',
    'dealersocket.com',
    'elead-crm.com',
    'outlook.office.com',
  ]) {
    expect(source).toContain(host);
  }
});
