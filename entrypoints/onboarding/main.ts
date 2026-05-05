/**
 * Brevmont Onboarding — Main Script
 * Bundled by WXT as a module, CSP-compliant for extension pages.
 *
 * Three entry paths into onboarding (in priority order):
 *   1. install_token — extension page is opened with ?install_token=… in the
 *      URL (deep-link from Day 3 email or admin Install.tsx). Validate
 *      server-side, populate credentials silently, skip to completion.
 *   2. brevmont_rep_session cookie — rep already authed via /join OAuth on
 *      app.brevmont.com. Background.ts already auto-configures via
 *      /api/session/to-license; this onboarding page is rarely hit on this
 *      path but if it IS hit (manual open from chrome://extensions), restore
 *      from chrome.storage.local saved progress.
 *   3. Manual — typed license key OR rep token. Legacy 4-step wizard.
 *
 * Sticky persistence: every keystroke in steps 1-4 debounces into
 * chrome.storage.local via lib/storage.debouncedPatch. The profile_onboarding
 * key now holds shape { step, data, last_saved_at } so the wizard can resume
 * exactly where the user left off, even after Chrome crashes / extension
 * reloads. (Previous code used chrome.storage.sync which had a 5-30s replication
 * lag, so the resume was lossy.)
 */

import { telemetry } from '../lib/telemetry';
import { openRepPostInstallDestination } from '../lib/repAfterInstall';
import * as storage from '../../lib/storage';

const PROXY_URL = 'https://api.brevmont.com';

let currentStep = 1;
// Which auth path the user is on: 'manager' (license key, one per dealership)
// or 'rep' (rep token, one per rep). Defaults to manager for back-compat.
let authRole: 'manager' | 'rep' = 'manager';
// Populated by /v1/rep/validate-token on successful rep-token validation.
let repSession: {
  rep_auth_token: string;
  rep_id: string;
  rep_name: string;
  dealership_id: string;
  dealership_name: string;
} | null = null;
let profileData = {
  identity: { firstName:'', lastName:'', jobTitle:'', customTitle:'', yearsExperience:'' },
  dealership: { name:'', city:'', state:'', licenseKey:'', repToken:'', crm:'', saltRoads:'no', avgNewPrice:'', avgUsedPrice:'', docFee:'', taxRate:'' },
  voice: { tone:'professional', emojis:'sometimes', textSignature:'', emailSignoff:'', languages:['english'], philosophy:'' },
  market: { customerTypes:[] as string[], objections:[] as string[], marketType:'', customerNote:'' }
};

// Boot path: storage init → URL token check → onboarded check → resume.
// Each step is short-circuited by an earlier success.
(async function boot() {
  try {
    await storage.init();
  } catch (_) {
    // storage migration failure is non-fatal — we fall through to legacy reads.
  }

  // EXIT FIRST if already activated — before install_token, cookie path, or resume.
  // Requires dealer_token so we don't close on a half-written profile flag alone.
  try {
    const gate = await new Promise<{ profile_onboarded?: boolean; dealer_token?: string }>((resolve) => {
      chrome.storage.local.get(['profile_onboarded', 'dealer_token'], (d) =>
        resolve(d as { profile_onboarded?: boolean; dealer_token?: string }),
      );
    });
    if (gate.profile_onboarded && gate.dealer_token) {
      window.close();
      return;
    }
  } catch (_) {
    /* noop */
  }

  // Path 1 — install_token in URL. Highest priority.
  const url = new URL(window.location.href);
  const installToken = url.searchParams.get('install_token');
  if (installToken) {
    const ok = await tryAutoConfigFromInstallToken(installToken);
    if (ok) {
      // Strip the token from the URL so a refresh / share doesn't try to
      // burn it again (it's already been consumed server-side).
      url.searchParams.delete('install_token');
      window.history.replaceState({}, document.title, url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
      // Hand control to completion screen — credentials are already in storage.
      try {
        const stored = await storage.getMany(['dealership', 'rep_name']);
        document.getElementById('comp-name')!.textContent = stored.rep_name || 'You';
        document.getElementById('comp-dealer')!.textContent = stored.dealership || '';
        document.getElementById('comp-tone')!.textContent = 'Default';
      } catch (_) { /* noop */ }
      goToStep(5);
      return;
    }
    // Validate failed — show inline error on step 2 and let the user fall
    // back to manual entry.
    const err = document.getElementById('s2-license-err');
    if (err) {
      err.textContent = 'This install link expired or was already used. Ask whoever sent it to send a fresh one, or paste your license key below.';
      err.style.display = 'block';
    }
  }

  // Path 2 — brevmont_rep_session cookie (set by /join flow in webapp).
  // Reads the cookie from app.brevmont.com, calls /api/session/to-license
  // which returns full credentials for the rep. Skips manual entry entirely.
  const cookieOk = await tryAutoConfigFromCookie();
  if (cookieOk) {
    try {
      const stored = await storage.getMany(['dealership', 'rep_name']);
      document.getElementById('comp-name')!.textContent = stored.rep_name || 'You';
      document.getElementById('comp-dealer')!.textContent = stored.dealership || '';
      document.getElementById('comp-tone')!.textContent = 'Default';
    } catch (_) { /* noop */ }
    goToStep(5);
    return;
  }

  // Path 3/4 — onboarded check + resume from local-storage progress.
  let stored: {
    profile_onboarded?: boolean;
    profile_onboarding?: string | null;
    dealer_token?: string;
  } = {};
  try {
    stored = await new Promise((resolve) => {
      chrome.storage.local.get(['profile_onboarded', 'profile_onboarding', 'dealer_token'], (d) => resolve(d as any));
    });
  } catch (_) { /* noop */ }

  if (stored.profile_onboarded && stored.dealer_token) {
    window.close();
    return;
  }
  if (stored.profile_onboarding) {
    try {
      const saved = JSON.parse(stored.profile_onboarding);
      profileData = { ...profileData, ...saved.data };
      if (saved.step && saved.step <= 4) { goToStep(saved.step); restoreFields(); }
    } catch (_) { /* noop */ }
  }
})();

/**
 * Validate the URL-supplied install_token against the proxy. On success,
 * persists license_key + license_secret + dealer_token + identity to
 * chrome.storage.local atomically.
 */
async function tryAutoConfigFromInstallToken(token: string): Promise<boolean> {
  try {
    const resp = await fetch(`${PROXY_URL}/v1/install-tokens/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!resp.ok) {
      telemetry.trackError(new Error('install_token_validate_' + resp.status), { flow: 'install_token_validate', status: resp.status });
      return false;
    }
    const data = await resp.json();
    if (!data?.license_key || !data?.license_secret) {
      return false;
    }
    await storage.setCredentialsFromInstallToken({
      license_key: data.license_key,
      license_secret: data.license_secret,
      dealer_token: data.dealer_token || data.license_key,
      dealership_id: data.dealership_id,
      dealership_name: data.dealership_name,
      rep_id: data.rep_id || null,
      rep_email: data.rep_email || null,
      rep_name: data.rep_name || null,
    });
    try {
      await chrome.storage.local.set({
        brevmont_extension_role: (data.rep_id || data.rep_auth_token) ? 'rep' : 'manager',
      });
    } catch (_) { /* noop */ }
    // Mark onboarded so the popup/options pages don't re-prompt.
    await storage.patch({
      profile_onboarded: true,
      profile_onboarding: null,
    });
    return true;
  } catch (e: any) {
    telemetry.trackError(e instanceof Error ? e : new Error(String(e)), { flow: 'install_token_validate' });
    return false;
  }
}

/**
 * Try auto-config from brevmont_rep_session cookie (set by /join flow).
 * Calls /api/session/to-license which returns full credentials for the rep.
 * This is the zero-friction path for reps who joined via the webapp invite.
 */
async function tryAutoConfigFromCookie(): Promise<boolean> {
  try {
    // Read the brevmont_rep_session cookie from app.brevmont.com
    let cookieVal: string | null = null;
    try {
      const cookie = await chrome.cookies.get({
        url: 'https://app.brevmont.com',
        name: 'brevmont_rep_session',
      });
      cookieVal = cookie?.value || null;
    } catch (_) { /* cookies permission missing or cookie absent */ }

    if (!cookieVal) return false;

    const resp = await fetch(`${PROXY_URL}/api/session/to-license`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${cookieVal}`,
        'Accept': 'application/json',
      },
    });
    if (!resp.ok) return false;

    const data = await resp.json();
    if (!data?.license_key) return false;

    const toStore: Record<string, any> = {
      license_key: data.license_key,
      dealer_token: data.dealer_token || data.license_key,
      activated_at: Date.now(),
      license_revoked: false,
      profile_onboarded: true,
      profile_onboarding: null,
    };
    if (data.license_secret) {
      toStore.license_secret = data.license_secret;
      toStore.brevmont_license_secret = data.license_secret;
    }
    if (data.dealership_name) toStore.dealership = data.dealership_name;
    if (data.dealership_id) toStore.dealership_id = data.dealership_id;
    if (data.rep_name) toStore.rep_name = data.rep_name;
    if (data.rep_email) toStore.rep_email = data.rep_email;
    if (data.rep_id) toStore.rep_id = data.rep_id;
    if (data.rep_auth_token) toStore.rep_auth_token = data.rep_auth_token;
    toStore.brevmont_extension_role = 'rep';

    await chrome.storage.local.set(toStore);
    await chrome.storage.local.remove(['license_revoked_at', 'license_revoked_message']);
    try { chrome.action?.setBadgeText?.({ text: '' }); } catch {}
    return true;
  } catch (e: any) {
    telemetry.trackError(e instanceof Error ? e : new Error(String(e)), { flow: 'cookie_auto_config' });
    return false;
  }
}

function saveProgress() {
  collectCurrentStep();
  // Sticky persistence: debounced write to chrome.storage.local. 250ms debounce
  // is enough that 8 keystrokes in a row coalesce into one IPC, and short
  // enough that a tab close 300ms later still saves.
  storage.debouncedPatch(
    { profile_onboarding: JSON.stringify({ step: currentStep, data: profileData, last_saved_at: Date.now() }) },
    250,
    'profile_onboarding'
  );
}

function collectCurrentStep() {
  if (currentStep === 1) {
    profileData.identity.firstName = g('s1-first');
    profileData.identity.lastName = g('s1-last');
    const sel = document.getElementById('s1-title') as HTMLSelectElement;
    profileData.identity.jobTitle = sel.value === 'other' ? g('s1-title-other') : sel.value;
    profileData.identity.yearsExperience = (document.getElementById('s1-years') as HTMLSelectElement).value;
  } else if (currentStep === 2) {
    profileData.dealership.name = g('s2-dealer');
    profileData.dealership.city = g('s2-city');
    profileData.dealership.state = g('s2-state');
    profileData.dealership.licenseKey = g('s2-license');
    profileData.dealership.repToken = g('s2-reptoken');
    profileData.dealership.crm = (document.getElementById('s2-crm') as HTMLSelectElement).value;
    profileData.dealership.docFee = g('s2-docfee');
    profileData.dealership.taxRate = g('s2-tax');
    profileData.dealership.avgNewPrice = (document.getElementById('s2-avg-new') as HTMLSelectElement).value;
    profileData.dealership.avgUsedPrice = (document.getElementById('s2-avg-used') as HTMLSelectElement).value;
  } else if (currentStep === 3) {
    profileData.voice.textSignature = g('s3-textsig');
    profileData.voice.emailSignoff = g('s3-emailsig');
    profileData.voice.philosophy = g('s3-philosophy');
    profileData.voice.languages = getChipValues(document.querySelectorAll('#screen-3 .chip-toggle.on'));
  } else if (currentStep === 4) {
    profileData.market.customerTypes = getChipValues(document.querySelectorAll('#s4-customers .chip-toggle.on'));
    profileData.market.objections = getChipValues(document.querySelectorAll('#s4-objections .chip-toggle.on'));
    profileData.market.customerNote = g('s4-custnote');
  }
}

function restoreFields() {
  const id = profileData.identity;
  const dl = profileData.dealership;
  const vc = profileData.voice;
  const mk = profileData.market;
  s('s1-first', id.firstName); s('s1-last', id.lastName);
  if (id.jobTitle) {
    const sel = document.getElementById('s1-title') as HTMLSelectElement;
    const opt = Array.from(sel.options).find(o => o.value === id.jobTitle || o.text === id.jobTitle);
    if (opt) sel.value = opt.value; else { sel.value = 'other'; s('s1-title-other', id.jobTitle); document.getElementById('s1-title-other-wrap')!.style.display = 'block'; }
  }
  if (id.yearsExperience) (document.getElementById('s1-years') as HTMLSelectElement).value = id.yearsExperience;
  s('s2-dealer', dl.name); s('s2-city', dl.city); s('s2-state', dl.state); s('s2-license', dl.licenseKey);
  if (dl.crm) (document.getElementById('s2-crm') as HTMLSelectElement).value = dl.crm;
  s('s2-docfee', dl.docFee); s('s2-tax', dl.taxRate);
  if (dl.avgNewPrice) (document.getElementById('s2-avg-new') as HTMLSelectElement).value = dl.avgNewPrice;
  if (dl.avgUsedPrice) (document.getElementById('s2-avg-used') as HTMLSelectElement).value = dl.avgUsedPrice;
  if (dl.saltRoads) setSalt(dl.saltRoads);
  if (vc.tone) document.querySelectorAll('.tone-card[data-tone]').forEach(c => (c as HTMLElement).classList.toggle('selected', (c as HTMLElement).dataset.tone === vc.tone));
  if (vc.emojis) setEmoji(vc.emojis);
  s('s3-textsig', vc.textSignature); s('s3-emailsig', vc.emailSignoff); s('s3-philosophy', vc.philosophy);
  vc.languages.forEach(l => { const c = document.querySelector(`#screen-3 .chip-toggle[data-val="${l}"]`); if (c) c.classList.add('on'); });
  mk.customerTypes.forEach(v => { const c = document.querySelector(`#s4-customers .chip-toggle[data-val="${v}"]`); if (c) c.classList.add('on'); });
  mk.objections.forEach(v => { const c = document.querySelector(`#s4-objections .chip-toggle[data-val="${v}"]`); if (c) c.classList.add('on'); });
  if (mk.marketType) document.querySelectorAll('[data-market]').forEach(c => (c as HTMLElement).classList.toggle('selected', (c as HTMLElement).dataset.market === mk.marketType));
  s('s4-custnote', mk.customerNote);
}

function g(id: string) { return ((document.getElementById(id) as HTMLInputElement)?.value || '').trim(); }
function s(id: string, val: string) { const el = document.getElementById(id) as HTMLInputElement; if (el && val) el.value = val; }
function getChipValues(chips: NodeListOf<Element>) { return Array.from(chips).map(c => (c as HTMLElement).dataset.val).filter(Boolean) as string[]; }

function goToStep(n: number) {
  currentStep = n;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + n)?.classList.add('active');
  for (let i = 1; i <= 4; i++) {
    const dot = document.getElementById('dot-' + i)!;
    dot.classList.remove('active', 'done');
    if (i < n) dot.classList.add('done');
    else if (i === n) dot.classList.add('active');
  }
  document.getElementById('step-label')!.textContent = n <= 4 ? `Step ${n} of 4` : 'Complete';
}

function next(from: number) {
  collectCurrentStep();
  if (from === 1) {
    if (!profileData.identity.firstName || !profileData.identity.lastName) { alert('Name is required.'); return; }
    if (!profileData.identity.jobTitle) { alert('Select your job title.'); return; }
  } else if (from === 2) {
    if (!profileData.dealership.name || !profileData.dealership.city || !profileData.dealership.state) { alert('Dealership info is required.'); return; }
    if (authRole === 'rep') {
      if (!profileData.dealership.repToken) { alert('Rep token is required.'); return; }
      validateRepToken(profileData.dealership.repToken).then(valid => {
        if (valid) { saveProgress(); goToStep(3); }
        else { document.getElementById('s2-reptoken-err')!.style.display = 'block'; document.getElementById('s2-reptoken-ok')!.style.display = 'none'; }
      });
      return;
    }
    if (!profileData.dealership.licenseKey) { alert('License key is required.'); return; }
    validateLicense(profileData.dealership.licenseKey).then(valid => {
      if (valid) { saveProgress(); goToStep(3); }
      else { document.getElementById('s2-license-err')!.style.display = 'block'; document.getElementById('s2-license-ok')!.style.display = 'none'; }
    });
    return;
  }
  saveProgress();
  goToStep(from + 1);
}

function prev(from: number) { collectCurrentStep(); saveProgress(); goToStep(from - 1); }

async function validateLicense(key: string) {
  const errEl = document.getElementById('s2-license-err');
  const okEl = document.getElementById('s2-license-ok');
  function showError(msg: string) {
    if (errEl) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
    }
    if (okEl) okEl.style.display = 'none';
  }
  try {
    const resp = await fetch(`${PROXY_URL}/v1/license/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: key }),
    });

    if (resp.status === 400) {
      let body: any = {};
      try { body = await resp.json(); } catch {}
      showError(body?.error || 'Invalid license key format. Please check and try again.');
      telemetry.trackError(new Error(body?.error || 'bad_license_format'), { flow: 'license_validation', status: 400 });
      return false;
    }
    if (resp.status === 401) {
      let body: any = {};
      try { body = await resp.json(); } catch {}
      showError(body?.error || 'License key is invalid. Contact support if you believe this is a mistake.');
      telemetry.trackError(new Error(body?.error || 'license_invalid'), { flow: 'license_validation', status: 401 });
      return false;
    }
    if (resp.status === 403) {
      let body: any = {};
      try { body = await resp.json(); } catch {}
      showError(body?.error || 'This license has been revoked. Please contact support to reactivate.');
      telemetry.trackError(new Error(body?.error || 'license_revoked'), { flow: 'license_validation', status: 403 });
      return false;
    }
    if (!resp.ok) {
      showError(`License check failed (${resp.status}). Try again in a moment.`);
      telemetry.trackError(new Error('license_http_' + resp.status), { flow: 'license_validation', status: resp.status });
      return false;
    }

    const data = await resp.json();
    if (!data?.valid) {
      showError(data?.error || 'License key not recognized.');
      telemetry.trackError(new Error(data?.error || 'invalid_license'), { flow: 'license_validation' });
      return false;
    }

    const dealer = data.dealership || null;
    const dbName = typeof dealer === 'string' ? dealer : dealer?.name || null;
    if (dbName) {
      profileData.dealership.name = dbName;
      const nameInput = document.getElementById('s2-dealership') as HTMLInputElement;
      if (nameInput) { nameInput.value = dbName; nameInput.readOnly = true; nameInput.style.opacity = '0.7'; }
    }
    // Auto-fill city/state if returned by API (FIX 2)
    if (dealer && typeof dealer === 'object') {
      if (dealer.city) {
        profileData.dealership.city = dealer.city;
        const cityInput = document.getElementById('s3-city') as HTMLInputElement;
        if (cityInput) { cityInput.value = dealer.city; }
      }
      if (dealer.state) {
        profileData.dealership.state = dealer.state;
        const stateInput = document.getElementById('s3-state') as HTMLInputElement;
        if (stateInput) { stateInput.value = dealer.state; }
      }
    }

    // Persist credentials returned by proxy. Clear any prior revocation flag.
    // Stored under BOTH `license_secret` (legacy key, kept for backward compat)
    // AND `brevmont_license_secret` (the key authSigning.getLicenseCredentials
    // actually reads). Without the canonical key, requests stay unsigned until
    // the 15s bootstrap fetcher runs — and Phase 2 rejects every unsigned
    // generate in that window with 401 signature_required.
    const toStore: Record<string, any> = {
      license_key: key,
      activated_at: Date.now(),
      license_revoked: false,
    };
    if (data.dealer_token) toStore.dealer_token = data.dealer_token;
    if (data.license_secret) {
      toStore.license_secret = data.license_secret;
      toStore.brevmont_license_secret = data.license_secret;
    }
    if (dbName) toStore.dealership = dbName;
    if (dealer && typeof dealer === 'object' && dealer.id) toStore.dealership_id = dealer.id;
    toStore.brevmont_extension_role = 'manager';
    try {
      await chrome.storage.local.set(toStore);
      // Also remove the stale revocation fields so old state doesn't linger
      await chrome.storage.local.remove(['license_revoked_at', 'license_revoked_message']);
    } catch {}

    // Clear revocation badge
    try { chrome.action?.setBadgeText?.({ text: '' }); } catch {}

    if (okEl) okEl.style.display = 'block';
    if (errEl) errEl.style.display = 'none';
    return true;
  } catch(e: any) {
    showError('Network error validating license. Check your connection and try again.');
    telemetry.trackError(e instanceof Error ? e : new Error(String(e)), { flow: 'license_validation' });
    // Report to background too (legacy channel)
    try { chrome.runtime.sendMessage({ type: 'REPORT_ERROR', payload: { error_type: 'AUTH_ERROR', error_message: e?.message || 'License validation failed', context: 'onboarding_step2' } }); } catch(_) {}
    return false;
  }
}

// Toggle manager <-> rep auth path. Shows/hides the correct input field and
// updates in-memory state. Called when the user clicks the role toggle cards.
function setAuthRole(role: 'manager' | 'rep') {
  authRole = role;
  document.querySelectorAll('#s2-role .tone-card[data-role]').forEach(c => {
    (c as HTMLElement).classList.toggle('selected', (c as HTMLElement).dataset.role === role);
  });
  const licWrap = document.getElementById('s2-license-wrap');
  const repWrap = document.getElementById('s2-reptoken-wrap');
  if (licWrap) licWrap.style.display = role === 'manager' ? '' : 'none';
  if (repWrap) repWrap.style.display = role === 'rep' ? '' : 'none';
}

async function validateRepToken(token: string) {
  const errEl = document.getElementById('s2-reptoken-err');
  const okEl = document.getElementById('s2-reptoken-ok');
  function showError(msg: string) {
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    if (okEl) okEl.style.display = 'none';
  }
  // Cheap client-side format gate before burning a proxy call.
  if (!/^BRVMT-REP-/i.test(token)) {
    showError('Rep token must start with BRVMT-REP-');
    return false;
  }
  try {
    const resp = await fetch(`${PROXY_URL}/v1/rep/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
      let body: any = {};
      try { body = await resp.json(); } catch {}
      showError(body?.error || 'Rep token is invalid or expired. Check with your manager.');
      telemetry.trackError(new Error(body?.error || 'rep_token_invalid'), { flow: 'rep_token_validation', status: resp.status });
      return false;
    }
    if (!resp.ok) {
      showError(`Rep token check failed (${resp.status}). Try again in a moment.`);
      telemetry.trackError(new Error('rep_token_http_' + resp.status), { flow: 'rep_token_validation', status: resp.status });
      return false;
    }

    const data = await resp.json();
    if (!data?.valid) {
      showError(data?.error || 'Rep token not recognized.');
      telemetry.trackError(new Error(data?.error || 'rep_token_invalid'), { flow: 'rep_token_validation' });
      return false;
    }

    // Cache validated payload for finish() to persist. The endpoint now returns
    // full credentials (license_key, license_secret, dealer_token) plus identity.
    repSession = {
      rep_auth_token: token,
      rep_id: data.rep_id || '',
      rep_name: data.rep_name || '',
      dealership_id: data.dealership_id || '',
      dealership_name: data.dealership || data.dealership_name || profileData.dealership.name || '',
    };

    // Persist license credentials so the extension can sign requests immediately
    const toStore: Record<string, any> = {
      rep_auth_token: token,
      activated_at: Date.now(),
      license_revoked: false,
    };
    if (data.license_key) toStore.license_key = data.license_key;
    if (data.dealer_token) toStore.dealer_token = data.dealer_token;
    if (data.license_secret) {
      toStore.license_secret = data.license_secret;
      toStore.brevmont_license_secret = data.license_secret;
    }
    if (data.dealership_id) toStore.dealership_id = data.dealership_id;
    if (repSession.dealership_name) toStore.dealership = repSession.dealership_name;
    if (data.rep_id) toStore.rep_id = data.rep_id;
    if (data.rep_email) toStore.rep_email = data.rep_email;
    if (data.rep_name) toStore.rep_name = data.rep_name;
    toStore.brevmont_extension_role = 'rep';
    try {
      await chrome.storage.local.set(toStore);
      await chrome.storage.local.remove(['license_revoked_at', 'license_revoked_message']);
    } catch {}
    try { chrome.action?.setBadgeText?.({ text: '' }); } catch {}

    // If the server resolved the dealership name, overwrite local copy so
    // downstream prompts use the canonical name rather than whatever the rep
    // typed.
    if (repSession.dealership_name) {
      profileData.dealership.name = repSession.dealership_name;
      const nameInput = document.getElementById('s2-dealer') as HTMLInputElement;
      if (nameInput) nameInput.value = repSession.dealership_name;
    }

    if (okEl) okEl.style.display = 'block';
    if (errEl) errEl.style.display = 'none';
    return true;
  } catch (e: any) {
    showError('Network error validating rep token. Check your connection and try again.');
    telemetry.trackError(e instanceof Error ? e : new Error(String(e)), { flow: 'rep_token_validation' });
    try { chrome.runtime.sendMessage({ type: 'REPORT_ERROR', payload: { error_type: 'AUTH_ERROR', error_message: e?.message || 'Rep token validation failed', context: 'onboarding_step2_rep' } }); } catch (_) {}
    return false;
  }
}

async function finish() {
  collectCurrentStep();
  const profile = {
    identity: profileData.identity,
    dealership: profileData.dealership,
    voice: profileData.voice,
    market: profileData.market,
    onboarded: true,
    onboarded_at: new Date().toISOString()
  };
  // The dealer_token written here must be the server-issued dtk_xxx UUID
  // returned by /v1/license/validate (stored into chrome.storage.local by
  // validateLicense at line ~202), NOT the human license key the rep typed
  // into the form. If we write the raw license_key into sync.dealer_token,
  // lib/authSigning.getLicenseCredentials reads that for every signed
  // request. The server's lookupLicenseKey then resolves it to
  // dealerships.license_secret, but the extension is signing with
  // dealer_tokens.license_secret — the two don't match on Phase 2
  // dealerships and every /v1/generate returns 401 signature_invalid.
  //
  // This bug was confirmed live against prod on 2026-04-19 and was the
  // reason the Saturday dry-run was going to die at the first pill click.
  let dealerTokenForSync: string;
  try {
    const stored = await chrome.storage.local.get(['dealer_token']);
    dealerTokenForSync = (stored?.dealer_token as string | undefined) || profileData.dealership.licenseKey;
  } catch {
    dealerTokenForSync = profileData.dealership.licenseKey;
  }

  // Write to BOTH local (instant, source of truth) and sync (cross-device
  // mirror). sync can lag several seconds replicating through Chrome sync
  // servers; local reads never lag. Options page + popup read local first.
  const payload: Record<string, any> = {
    'profile': JSON.stringify(profile),
    'profile_onboarded': true,
    'rep_name': profileData.identity.firstName + ' ' + profileData.identity.lastName,
    'dealership': profileData.dealership.name,
    'dealer_token': dealerTokenForSync,
    brevmont_extension_role: authRole === 'rep' ? 'rep' : 'manager',
  };
  // If this install used the rep-token path, write the rep session fields to
  // sync so popup/options can display identity, and dual-write the token to
  // local under BOTH key names. Matches the license_secret / brevmont_license_secret
  // dual-write pattern in validateLicense — keeps legacy readers working while
  // moving to the canonical brevmont_-prefixed key.
  if (authRole === 'rep' && repSession) {
    payload.rep_auth_token = repSession.rep_auth_token;
    if (repSession.rep_id) payload.rep_id = repSession.rep_id;
    if (repSession.rep_name) payload.rep_name = repSession.rep_name;
    if (repSession.dealership_id) payload.dealership_id = repSession.dealership_id;
    if (repSession.dealership_name) payload.dealership = repSession.dealership_name;
    try {
      await chrome.storage.local.set({
        rep_auth_token: repSession.rep_auth_token,
        brevmont_rep_auth_token: repSession.rep_auth_token,
      });
    } catch (_) { /* noop */ }
  }
  try {
    await chrome.storage.local.set(payload);
  } catch (_) { /* noop */ }
  chrome.storage.sync.set(payload, () => {
    chrome.storage.sync.remove('profile_onboarding');
    chrome.storage.local.remove('profile_onboarding');
    document.getElementById('comp-name')!.textContent = profileData.identity.firstName + ' ' + profileData.identity.lastName;
    document.getElementById('comp-dealer')!.textContent = profileData.dealership.name + ' — ' + profileData.dealership.city + ', ' + profileData.dealership.state;
    document.getElementById('comp-tone')!.textContent = profileData.voice.tone.charAt(0).toUpperCase() + profileData.voice.tone.slice(1);
    goToStep(5);
    syncProfileToSupabase(profile).catch((e: any) => {
      try { chrome.runtime.sendMessage({ type: 'REPORT_ERROR', payload: { error_type: 'API_ERROR', error_message: e?.message || 'Profile sync to Supabase failed', context: 'onboarding_finish' } }); } catch(_) {}
    });
  });
}

async function syncProfileToSupabase(profile: any) {
  // Phase 1e: Supabase key removed from extension. Rep profile now flows
  // through the proxy. If a proxy profile-sync endpoint exists it goes here;
  // otherwise this is a best-effort no-op — the profile is already persisted
  // locally in chrome.storage.sync and the proxy can re-derive rep identity
  // from dealer_token + heartbeat.
  try {
    const r = await chrome.storage.local.get(['dealer_token']);
    const dealerToken = r?.dealer_token as string | undefined;
    if (!dealerToken) return;
    await fetch(`${PROXY_URL}/api/rep-profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${dealerToken}`,
      },
      body: JSON.stringify({
        first_name: profile.identity.firstName,
        last_name: profile.identity.lastName,
        job_title: profile.identity.jobTitle,
        years_experience: profile.identity.yearsExperience,
        dealership: profile.dealership.name,
        tone: profile.voice.tone,
        languages: profile.voice.languages,
        market_type: profile.market.marketType,
      }),
    });
  } catch (e: any) {
    telemetry.trackError(e instanceof Error ? e : new Error(String(e)), { flow: 'profile_sync' });
  }
}

async function openBrevmont() {
  const stored = await new Promise<any>((resolve) => {
    chrome.storage.local.get(['brevmont_extension_role', 'dealer_token'], resolve);
  });

  const role = stored.brevmont_extension_role || 'rep';
  const repRoles = ['rep', 'sales_rep'];

  if (repRoles.includes(role)) {
    await openRepPostInstallDestination();
  } else {
    try {
      chrome.tabs.create({ url: 'https://app.brevmont.com/dashboard' });
      window.close();
    } catch {
      window.location.href = 'https://app.brevmont.com/dashboard';
    }
  }
}

// UI helpers
function setTone(el: HTMLElement) { document.querySelectorAll('.tone-card[data-tone]').forEach(c => c.classList.remove('selected')); el.classList.add('selected'); profileData.voice.tone = el.dataset.tone || ''; }
function setMarket(el: HTMLElement) { document.querySelectorAll('[data-market]').forEach(c => c.classList.remove('selected')); el.classList.add('selected'); profileData.market.marketType = el.dataset.market || ''; }
function setSalt(val: string) { profileData.dealership.saltRoads = val; document.querySelectorAll('#s2-salt button').forEach(b => b.classList.toggle('active', b.textContent!.toLowerCase() === val)); }
function setEmoji(val: string) { profileData.voice.emojis = val; document.querySelectorAll('#s3-emoji button').forEach(b => b.classList.toggle('active', b.textContent!.toLowerCase() === val)); }
function toggleChip(el: HTMLElement) {
  el.classList.toggle('on');
  const spanishOn = document.querySelector('#screen-3 .chip-toggle[data-val="spanish"].on');
  const hint = document.getElementById('s3-lang-hint');
  if (hint) hint.style.display = spanishOn ? 'block' : 'none';
}

// Title "Other" toggle
document.getElementById('s1-title')!.addEventListener('change', function(this: HTMLSelectElement) {
  document.getElementById('s1-title-other-wrap')!.style.display = this.value === 'other' ? 'block' : 'none';
});

// Character counters
document.getElementById('s3-philosophy')?.addEventListener('input', function(this: HTMLTextAreaElement) { document.getElementById('s3-phil-count')!.textContent = String(this.value.length); });
document.getElementById('s4-custnote')?.addEventListener('input', function(this: HTMLTextAreaElement) { document.getElementById('s4-note-count')!.textContent = String(this.value.length); });

// ===== EVENT LISTENERS =====
document.getElementById('btn-next-1')!.addEventListener('click', () => next(1));
document.getElementById('btn-next-2')!.addEventListener('click', () => next(2));
document.getElementById('btn-next-3')!.addEventListener('click', () => next(3));
document.getElementById('btn-prev-2')!.addEventListener('click', () => prev(2));
document.getElementById('btn-prev-3')!.addEventListener('click', () => prev(3));
document.getElementById('btn-prev-4')!.addEventListener('click', () => prev(4));
document.getElementById('btn-finish')!.addEventListener('click', () => finish());
document.getElementById('btn-open')!.addEventListener('click', () => openBrevmont());

document.querySelectorAll('#s2-role .tone-card[data-role]').forEach(c =>
  c.addEventListener('click', () => setAuthRole(((c as HTMLElement).dataset.role as 'manager' | 'rep') || 'manager'))
);
document.querySelectorAll('#s2-salt button').forEach(b => b.addEventListener('click', () => setSalt(b.textContent!.toLowerCase())));
document.querySelectorAll('#s3-emoji button').forEach(b => b.addEventListener('click', () => setEmoji(b.textContent!.toLowerCase())));
document.querySelectorAll('.tone-card[data-tone]').forEach(c => c.addEventListener('click', () => setTone(c as HTMLElement)));
document.querySelectorAll('[data-market]').forEach(c => c.addEventListener('click', () => setMarket(c as HTMLElement)));
document.querySelectorAll('.chip-toggle').forEach(c => c.addEventListener('click', () => toggleChip(c as HTMLElement)));

// Sticky inputs — every keystroke debounces a save into chrome.storage.local
// so a tab close, browser crash, or extension reload restores exactly what
// the rep typed. Without this, reps had to retype dealership name + city +
// state every time they re-opened the wizard (Lab Note 2026-04-29).
const STICKY_INPUT_IDS = [
  's1-first', 's1-last', 's1-title-other', 's1-years',
  's2-dealer', 's2-city', 's2-state', 's2-license', 's2-reptoken',
  's2-docfee', 's2-tax',
  's3-textsig', 's3-emailsig', 's3-philosophy',
  's4-custnote',
];
for (const id of STICKY_INPUT_IDS) {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  if (!el) continue;
  el.addEventListener('input', () => saveProgress());
  el.addEventListener('change', () => saveProgress());
  el.addEventListener('blur', () => saveProgress());
}
const STICKY_SELECT_IDS = ['s1-title', 's2-crm', 's2-avg-new', 's2-avg-used'];
for (const id of STICKY_SELECT_IDS) {
  const el = document.getElementById(id) as HTMLSelectElement | null;
  if (!el) continue;
  el.addEventListener('change', () => saveProgress());
}
// Click-driven controls (chips, tone cards, salt/emoji buttons) all already
// mutate profileData inline; saveProgress is also called via next() but a
// final-defense flush on click keeps unsaved chip selections from being lost
// when the rep closes the tab mid-screen.
document.querySelectorAll('#screen-3 .chip-toggle, #s4-customers .chip-toggle, #s4-objections .chip-toggle, #s2-salt button, #s3-emoji button, .tone-card[data-tone], [data-market]').forEach((el) => {
  el.addEventListener('click', () => saveProgress());
});
