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
  expect(body).toContain('let scan: AutoThreadScan | null = null');
  expect(body.indexOf('scan = await scanThreadForGenerate(root, true)')).toBeGreaterThan(-1);
  expect(body.indexOf('scan = await scanThreadForGenerate(root, true)')).toBeLessThan(
    body.indexOf('if (!scan) scan = getUsableAutoThreadScan()'),
  );
  expect(body.indexOf("root.querySelectorAll('.chip.on')")).toBeGreaterThan(
    body.indexOf('scan = await scanThreadForGenerate(root, true)'),
  );
  expect(body.indexOf("const selectedType = normalizeDefaultOutputChip")).toBeGreaterThan(
    body.indexOf("root.querySelectorAll('.chip.on')"),
  );
  expect(body).toContain("const type = 'all'");
  expect(body).toContain("workflow_type: 'all'");
  expect(body).toContain('setActiveOutputTab(root, selectedReady || firstReady!)');
  expect(body).toContain('/v1/generate records one generation.created event for the one paid request');
  expect(body).not.toContain("selected.includes('text')");
});

test('manual Generate protects direct vehicle-condition questions from generic follow-up drift', () => {
  const background = read('entrypoints/background.ts');
  expect(background).toContain('function isVehicleConditionQuestionText');
  expect(background).toContain('function isFinanceQuestionText');
  expect(background).toContain('DIRECT CUSTOMER QUESTION OVERRIDE');
  expect(background).toContain('The latest customer message asks about vehicle condition');
  expect(background).toContain('The latest customer message asks about financing, credit, down payment, payment estimates, or co-signers');
  expect(background).toContain('Do not write a generic availability follow-up');
  expect(background).toContain('looksLikeGenericAvailabilityFollowup(sections.text)');
  expect(background).toContain('sections.text = vehicleConditionFallbackReply()');
  expect(background).toContain('looksLikeGenericFollowupForDirectQuestion(sections.text, latestInbound)');
  expect(background).toContain('sections.text = financeFallbackReply(latestInbound)');
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

test('manual customer control appears only on the customer stamp, not inside the steer box', () => {
  const ui = read('entrypoints/lib/panelUI.ts');
  const css = read('entrypoints/lib/panelCSS.ts');
  const source = read('entrypoints/sidepanel/main.ts');
  expect(ui).not.toContain('id="o8-customer-open"');
  expect(ui).not.toContain('customer-picker-trigger');
  expect(css).not.toContain('.customer-picker-trigger');
  expect(source).not.toContain("el('o8-customer-open')");
});

test('customer stamp and reminder mic reserve enough visual space', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  const css = read('entrypoints/lib/panelCSS.ts');
  expect(source).toContain('class="customer-stamp-copy"');
  expect(css).toContain('.customer-stamp { flex:0 0 auto; margin:8px 12px 8px;');
  expect(css).toContain('.customer-stamp-row { display:flex; align-items:center; gap:9px; padding:8px 9px; min-height:50px; }');
  expect(css).toContain('.customer-stamp-copy { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; justify-content:center; gap:1px; }');
  expect(css).toContain('.input-wrap input.main-input + .inline-mic { top:50%; right:6px; transform:translateY(-50%); }');
  expect(css).toContain('@keyframes mic-pulse-centered');
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
  expect(css).toContain('--panel-safe-bottom');
  expect(css).toContain('.settings-section { padding:16px 14px var(--panel-safe-bottom); }');
  expect(css).toContain('-webkit-overflow-scrolling:touch');
  expect(source).toContain("settingsPanel.querySelector('#overdrive-panel-mount')");
  expect(source).toContain("showPrimaryPanel(root, '#o8-settings-panel')");
  expect(source).toContain('resetPanelScroll(root, panel)');
});

test('Settings support actions stay inside the sidepanel instead of opening mailto tabs', () => {
  const ui = read('entrypoints/lib/panelUI.ts');
  const css = read('entrypoints/lib/panelCSS.ts');
  const source = read('entrypoints/sidepanel/main.ts');
  expect(ui).toContain('id="sp-support-card"');
  expect(ui).toContain('id="sp-copy-support-email"');
  expect(ui).toContain('id="sp-copy-support-details"');
  expect(ui).toContain('id="sp-settings-bottom-back"');
  expect(css).toContain('.settings-support-card');
  expect(css).toContain('.settings-footer-links');
  expect(source).toContain('async function showSettingsSupport');
  expect(source).toContain("helpBtn.onclick = (event) =>");
  expect(source).toContain("settingsBottomBack.onclick = () => showQuickView(root)");
  expect(source).not.toContain("chrome.tabs.create({ url: 'mailto:founder@brevmont.com' })");
});

test('sidepanel main and lead capture views scroll without clipping behind the account chip', () => {
  const css = read('entrypoints/lib/panelCSS.ts');
  const ui = read('entrypoints/lib/panelUI.ts');
  const source = read('entrypoints/sidepanel/main.ts');
  expect(css).toContain('--account-chip-space:76px');
  expect(css).toContain('--panel-safe-bottom');
  expect(css).toContain('.quick-mode { display:flex; flex-direction:column; flex:1 1 auto; height:100%; max-height:100%; min-height:0; overflow-y:auto;');
  expect(css).toContain('.outputs:not(:empty) { padding:8px 14px var(--panel-safe-bottom); flex:0 0 auto; min-height:auto; }');
  expect(css).toContain('.out-actions { position:relative; display:flex;');
  expect(css).toContain('#o8-lead-panel { overflow-y:auto;');
  expect(css).toContain('#o8-lead-panel > .tool-content { flex:0 0 auto !important; min-height:auto !important; overflow:visible !important;');
  expect(css).toContain('#o8-lead-result { height:auto; max-height:none; padding:8px 14px var(--panel-safe-bottom) !important; }');
  expect(ui).toContain('id="o8-my-leads-scroll"');
  expect(css).toContain('.my-leads-scroll { padding:12px 14px var(--panel-safe-bottom); }');
  expect(css).toContain('#o8-my-leads-content { flex:0 0 auto; min-height:auto; height:auto; max-height:none; overflow:visible; padding:0; }');
  expect(source).toContain('function fitOutputTextarea');
  expect(source).toContain('function resetPanelScroll');
  expect(source).toContain("root.style.display = 'flex'");
  expect(source).not.toContain("root.style.display = 'block'");
  expect(source).not.toContain("card.scrollIntoView({ block: 'nearest' })");
  expect(source).toContain('tool-content-active');
  expect(source).toContain("panel?.querySelectorAll<HTMLElement>('.settings-scroll, #o8-my-leads-scroll, #o8-stats-content, #o8-lead-result, .tool-content')");
});

test('Coach uses coach mode and rejects follow-up-shaped responses', () => {
  const background = read('entrypoints/background.ts');
  const source = read('entrypoints/sidepanel/main.ts');
  expect(background).toContain("workflow_type: 'coach_me'");
  expect(source).toContain('function looksLikeFollowUpGeneration');
  expect(source).toContain('function localCoachFallback');
  expect(source).toContain('coachDisplayText(input, rawText)');
  expect(source).toContain('TEXT|EMAIL|CRM');
  expect(source).toContain("if (target === 'coach' || target === 'command')");
  expect(source).not.toContain('result.textContent = existing + String(msg.text || \'\')');
});

test('Ask Anything is guarded as internal rep advice, never follow-up copy', () => {
  const background = read('entrypoints/background.ts');
  const source = read('entrypoints/sidepanel/main.ts');
  expect(background).toContain('ASK ANYTHING MODE - INTERNAL SALES ANSWER ONLY');
  expect(background).toContain('Never output TEXT, EMAIL, CRM NOTE');
  expect(background).toContain('Do not ask "do you mean" or clarifying questions');
  expect(source).toContain('function commandDisplayText');
  expect(source).toContain('function localCommandFallback');
  expect(source).toContain('looksLikeClarifyingQuestion');
  expect(source).toContain('9.9% APR');
});

test('primary panel navigation has one Back path to the Generate view', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  expect(source).toContain('function showQuickView');
  expect(source).toContain('function showPrimaryPanel');
  expect(source).toContain("settingsBack.onclick = () => showQuickView(root)");
  expect(source).toContain("toolsBack.onclick = () => { setActiveToolSection(root, null); showQuickView(root); }");
  expect(source).toContain("statsBack.onclick = () => showQuickView(root)");
  expect(source).toContain("myLeadsBack.onclick = () => showQuickView(root)");
  expect(source).toContain("showPrimaryPanel(root, '#o8-settings-panel')");
  expect(source).toContain("showPrimaryPanel(root, '#o8-lead-panel')");
});

test('Overdrive is rep-accessible unless manager settings explicitly disables it', () => {
  const panel = read('entrypoints/sidepanel/overdrivePanel.ts');
  const main = read('entrypoints/sidepanel/main.ts');
  const client = read('entrypoints/lib/overdrive/apiClient.ts');

  expect(client).toContain('dealership_disabled?: boolean');
  expect(panel).toContain('data.dealership_disabled === true');
  expect(panel).toContain('linked && disclosureAcked && !dealerBlocked');
  expect(panel).not.toContain('Your GM has Overdrive disabled at the dealership');
  expect(panel).not.toContain('!data.dealership_enabled');
  expect(panel).not.toContain('Upload thumbs-up selfie');
  expect(main).toContain('data.dealership_disabled === true');
  expect(main).toContain('prerequisites_met: linked && disclosureAcked');
  expect(main).not.toContain('Your GM has Overdrive disabled at the store');
  expect(main).not.toContain("title.textContent = 'Overdrive: off (dealership)'");
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

test('appointment saves create rep reminders through the same alarm path', () => {
  const background = read('entrypoints/background.ts');
  const source = read('entrypoints/sidepanel/main.ts');
  expect(source).toContain("stage: 'appointment_set', appointment_at");
  expect(background).toContain('async function upsertLocalReminder');
  expect(background).toContain("source: 'appointment_set'");
  expect(background).toContain('chrome.notifications.create');
  expect(background).toContain('SHOW_ALERT_BANNER');
  expect(background).toContain('brevmont-check-alerts');
});

test('Overdrive blocks unsafe meta replies before injection and clears failed drafts', () => {
  const orchestrator = read('entrypoints/lib/overdrive/orchestrator.ts');
  const background = read('entrypoints/lib/overdrive/backgroundController.ts');
  const content = read('entrypoints/content.ts');
  const bridge = read('entrypoints/lib/overdrive/contentBridge.ts');
  const sender = read('entrypoints/lib/overdrive/overdriveSend.ts');

  expect(orchestrator).toContain('UNSAFE_OVERDRIVE_REPLY_PATTERNS');
  expect(orchestrator).toContain('unsafeOverdriveReplyReason');
  expect(orchestrator).toContain('no_confident_inbound');
  expect(orchestrator).toContain('unsafe_reply:${unsafeReason}');
  expect(orchestrator).toContain('await deps.clearInjectedText?.(reply.reply_text || \'\')');
  expect(background).toContain("type: 'OVERDRIVE_CLEAR_INJECTED_TEXT'");
  expect(content).toContain("msg.type === 'OVERDRIVE_CLEAR_INJECTED_TEXT'");
  expect(content).toContain('composer_mismatch');
  expect(bridge).toContain("type MessageDirection = 'inbound' | 'outbound' | 'unknown'");
  expect(bridge).toContain("`${direction === 'outbound' ? 'Rep' : 'Customer'}:");
  expect(bridge).toContain("if (direction === 'unknown') {");
  expect(bridge).toContain('Ambiguous Messenger DOM should never trigger autonomous');
  expect(bridge).toContain('continue;');
  expect(bridge).not.toContain('lastInbound = text.slice(0, 2000);\\n        continue;');
  expect(sender).toContain('[aria-label*="Press Enter" i]');
  expect(sender).toContain("k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')");
});

test('Overdrive autonomous send runs inside the Messenger tab, not the background worker', () => {
  const orchestrator = read('entrypoints/lib/overdrive/orchestrator.ts');
  const background = read('entrypoints/lib/overdrive/backgroundController.ts');
  const content = read('entrypoints/content.ts');
  expect(orchestrator).not.toContain("import { overdriveSend } from './overdriveSend'");
  expect(orchestrator).not.toContain('const sendResult = await overdriveSend(');
  expect(orchestrator).toContain('sendText: (text: string) => Promise<OverdriveSendResult>');
  expect(orchestrator).toContain('const sendResult = await deps.sendText(reply.reply_text ||');
  expect(background).toContain("type: 'OVERDRIVE_SEND_TEXT'");
  expect(background).toContain('orchestrator_exception');
  expect(content).toContain("msg.type === 'OVERDRIVE_SEND_TEXT'");
  expect(content).toContain("await import('./lib/overdrive/overdriveSend')");
  expect(content).toContain('const result = await mod.overdriveSend(text)');
});

test('Overdrive ignores Messenger system cards and debounces by inbound hash, not tab', () => {
  const bridge = read('entrypoints/lib/overdrive/contentBridge.ts');
  const facebook = read('entrypoints/lib/platforms/facebook.ts');
  const sidepanel = read('entrypoints/sidepanel/main.ts');
  const shared = read('entrypoints/lib/messengerSystemText.ts');
  const background = read('entrypoints/lib/overdrive/backgroundController.ts');
  expect(shared).toContain("lower.includes('you can now rate each other')");
  expect(shared).toContain("lower.includes('people may rate one another based on their interactions or transactions')");
  expect(shared).toContain('is typing');
  expect(bridge).toContain("from '../messengerSystemText'");
  expect(facebook).toContain("from '../messengerSystemText'");
  expect(bridge).toContain('if (isMessengerSystemCardText(text)) continue;');
  expect(bridge).not.toContain('history.push(`Customer: ${text.slice(0, 460)}`);\\n        lastInbound = text.slice(0, 2000);');
  expect(bridge).toContain('lastReadableInboundFromHistory(history)');
  expect(facebook).toContain('if (isMessengerSystemCardText(text)) continue;');
  expect(sidepanel).toContain('function firstNonSystemThreadText');
  expect(sidepanel).toContain('function cleanThreadRawText');
  expect(sidepanel).toContain('!isMessengerSystemCardText(line)');
  expect(background).toContain('Let Messenger finish painting the latest bubble');
  expect(background).toContain('`${scrape.scrape.conversation_key}:${scrape.scrape.last_inbound_hash ||');
  expect(background).not.toContain('const debounceKey = `tab:${tabId}`');
});

test('Overdrive suppresses self-echo when Facebook re-renders our own autonomous reply', () => {
  const stateMachine = read('entrypoints/lib/overdrive/stateMachine.ts');
  const orchestrator = read('entrypoints/lib/overdrive/orchestrator.ts');
  expect(stateMachine).toContain('last_reply_text_norm');
  expect(stateMachine).toContain('normalizeOverdriveEchoText');
  expect(stateMachine).toContain("reason: 'own_reply_echo'");
  expect(stateMachine).toContain('inboundNorm === state.last_reply_text_norm');
  expect(orchestrator).toContain('last_inbound_text: scrape.last_inbound_text');
  expect(orchestrator).toContain("reply_text: reply.reply_text || ''");
});

test('Overdrive detector rearms with page-side ticks and watches Facebook text mutations', () => {
  const background = read('entrypoints/lib/overdrive/backgroundController.ts');
  const content = read('entrypoints/content.ts');
  const detector = read('entrypoints/lib/overdrive/overdriveDetector.ts');
  expect(background).not.toContain('if (state.perTabDetectorInstalled.has(tab.id)) continue;');
  expect(background).toContain("type: 'OVERDRIVE_DETECTOR_TICK'");
  expect(content).toContain("msg.type === 'OVERDRIVE_DETECTOR_TICK'");
  expect(content).toContain("await import('./lib/overdrive/overdriveDetector')");
  expect(detector).toContain('activeThreadTimer');
  expect(detector).toContain('mainWatchTimer');
  expect(detector).toContain('replaceActiveThreadObserver');
  expect(detector).toContain("conversation_hint: 'active_thread_rearmed'");
  expect(detector).toContain("if (m.type === 'characterData')");
  expect(detector).toContain('characterData: true');
  expect(detector).toContain('overdriveDetectorAlarmTick');
});

test('Overdrive header dot paints from the same state as the pill', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  const css = read('entrypoints/lib/panelCSS.ts');
  expect(source).toContain("root.querySelector('#o8-account-btn')");
  expect(source).toContain('paintHeaderDot');
  expect(source).toContain('Overdrive on and armed');
  expect(css).toContain('.account-btn.overdrive-dot-on');
  expect(css).toContain('.account-btn.overdrive-dot-on::after');
  expect(css).not.toContain('.account-btn.overdrive-dot-solo');
});

test('Overdrive is rep-facing on/off only with no test-mode or active-hours copy', () => {
  const ui = read('entrypoints/lib/panelUI.ts');
  const source = read('entrypoints/sidepanel/main.ts');
  const panel = read('entrypoints/sidepanel/overdrivePanel.ts');
  const stateMachine = read('entrypoints/lib/overdrive/stateMachine.ts');
  const background = read('entrypoints/lib/overdrive/backgroundController.ts');
  const content = read('entrypoints/content.ts');
  const safety = read('entrypoints/lib/overdrive/safetyEnvelope.ts');
  expect(ui).not.toContain('Solo test mode');
  expect(ui).not.toContain('o8-overdrive-solo-toggle');
  expect(source).not.toContain('solo_test_mode');
  expect(source).not.toContain('overdrive_solo_test_mode');
  expect(background).not.toContain('overdrive_solo_test_mode');
  expect(background).not.toContain('OVERDRIVE_SOLO_TEST_MODE');
  expect(content).not.toContain('OVERDRIVE_SOLO_TEST_MODE');
  expect(safety).not.toContain('soloTestMode');
  expect(panel).toContain('Overdrive is ON</div>');
  expect(panel).not.toContain('Overdrive is ON · active');
  expect(stateMachine).not.toContain('outside_active_hours');
  expect(stateMachine).not.toContain('active_hours:');
});

test('manual customer picker selection wins over auto-detection until thread changes', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  const start = source.indexOf('async function refreshCustomerDetection');
  const body = source.slice(start, source.indexOf('function startCustomerDetection', start));
  expect(source).toContain('let customerPickerOpen = false');
  expect(source).toContain('function cleanCustomerPickerRow');
  expect(source).toContain('function cleanCustomerPickerRows');
  expect(source).toContain('function isCustomerPickerOpen');
  expect(source).toContain('const rows = cleanCustomerPickerRows(customers)');
  expect(body).toContain('if (isCustomerPickerOpen(root)) return;');
  expect(body).toContain('if (isManualCustomerOverride(pinnedCustomer))');
  expect(body.indexOf('if (isManualCustomerOverride(pinnedCustomer))')).toBeLessThan(body.indexOf('if (confidence >= 0.8)'));
  expect(source.slice(source.indexOf('function pinMismatchReason'), source.indexOf('function clearStalePinnedCustomer'))).toContain('if (isManualCustomerOverride(customer)) return null;');
  expect(source).not.toContain("showToast(root, 'Customer context refreshed')");
});

test('sidepanel rejects Brevmont company labels before stamping customers', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  const gate = read('entrypoints/lib/leadContextScan.ts');
  expect(source).toContain("import { cleanCustomerNameCandidate } from '../lib/leadContextScan'");
  expect(source).toContain('return cleanCustomerNameCandidate(raw);');
  expect(source).toContain('const name = cleanCustomerNameCandidate(rawName);');
  expect(gate).toContain("'brevmont labs'");
  expect(gate).toContain("'archive'");
  expect(gate).toContain('export function cleanCustomerNameCandidate');
  expect(gate).toContain('.replace(/\\s*[·•-]\\s*(?:19|20)\\d{2}\\b.*$/i,');
  expect(gate).toContain('if (/^brevmont\\b/i.test(raw)) return true;');
});

test('Save Lead tab switches clear stale parsed results instead of leaving a split layout', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  const leadWire = source.slice(source.indexOf('function wireLeadCapture'), source.indexOf('// ─── Stats panel'));
  expect(leadWire).toContain('const clearLeadResult = () =>');
  expect(leadWire).toContain('if (!keepResult) clearLeadResult();');
  expect(leadWire).toContain("activateLeadTab('scan', true)");
});

test('generation failures render as retry-only errors, never injectable copy', () => {
  const source = read('entrypoints/sidepanel/main.ts');
  expect(source).toContain('function showGenerationError');
  expect(source).toContain('out-card out-card-error');
  expect(source).toContain('id="o8-error-regen"');
  expect(source).not.toContain("addOutput(root, 'Error'");
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

test('CRM notes cannot inject into social chat composers', () => {
  const sidepanel = read('entrypoints/sidepanel/main.ts');
  const content = read('entrypoints/content.ts');
  const facebook = read('entrypoints/lib/platforms/facebook.ts');
  const linkedin = read('entrypoints/lib/platforms/linkedin.ts');

  expect(sidepanel).toContain('On chat surfaces this must never touch the customer composer.');
  expect(sidepanel).toContain("currentPlatform.platform === 'vinsolutions'");
  expect(sidepanel).toContain("replace(/\\[(?:inbound|outbound|customer|rep)\\]\\s*/gi, '')");
  expect(content).toContain('const isMessageWriteAction');
  expect(content).toContain('const unsupportedKind =');
  expect(content).toContain("kind === 'crm_note' && !adapter.capabilities.supports_inject_crm_note");
  expect(content).not.toContain("(action === 'write_facebook_message' || PLATFORM === 'facebook')");
  expect(facebook).toContain('supports_inject_crm_note: false');
  expect(facebook).toContain("reason: 'facebook_only_supports_customer_message_inject'");
  expect(linkedin).toContain('supports_inject_crm_note: false');
  expect(linkedin).toContain("reason: 'linkedin_only_supports_customer_message_inject'");
});

test('lead stage updates fall back to local radar rows instead of surfacing Lead not found', () => {
  const background = read('entrypoints/background.ts');
  expect(background).toContain('async function updateLocalLeadStage');
  expect(background).toContain('/lead not found/i.test(errorText)');
  expect(background).toContain('sendResponse({ success: true, lead: localLead, local_only: true })');
  expect(background).toContain('syncPendingLeads().catch');
  expect(background).toContain("source: 'appointment_set'");
});

test('settings support footer has scroll room above the account chip', () => {
  const css = read('entrypoints/lib/panelCSS.ts');
  const source = read('entrypoints/sidepanel/main.ts');
  expect(css).toContain('.settings-scroll { padding-bottom:var(--panel-safe-bottom); }');
  expect(css).toContain('.settings-footer-links { border-top:1px solid #E5E7EB; margin-top:14px; padding-top:10px; padding-bottom:24px;');
  expect(source).toContain('requestAnimationFrame(() => {');
  expect(source).toContain('Math.max(0, card.offsetTop - 12)');
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
  expect(source).toContain("isDeterministicGmailThread ? '' : messages[messages.length - 1]?.text");
  expect(source).toContain("isDeterministicGmailThread ? '' : lastReadableThreadLine(rawText)");
  expect(source).toContain('firstNonSystemThreadText(');
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
