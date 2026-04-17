/**
 * Brevmont Onboarding — Main Script
 * Bundled by WXT as a module, CSP-compliant for extension pages.
 */

import { telemetry } from '../lib/telemetry';

const PROXY_URL = 'https://brevmont-proxy-production.up.railway.app';

let currentStep = 1;
let profileData = {
  identity: { firstName:'', lastName:'', jobTitle:'', customTitle:'', yearsExperience:'' },
  dealership: { name:'', city:'', state:'', licenseKey:'', crm:'', saltRoads:'no', avgNewPrice:'', avgUsedPrice:'', docFee:'', taxRate:'' },
  voice: { tone:'professional', emojis:'sometimes', textSignature:'', emailSignoff:'', languages:['english'], philosophy:'' },
  market: { customerTypes:[] as string[], objections:[] as string[], marketType:'', customerNote:'' }
};

// Check if already onboarded — if so, close this tab immediately
chrome.storage.sync.get(['profile_onboarded', 'profile_onboarding'], (d: any) => {
  if (d.profile_onboarded) {
    window.close();
    return;
  }
  // Resume from saved progress
  if (d.profile_onboarding) {
    try {
      const saved = JSON.parse(d.profile_onboarding);
      profileData = { ...profileData, ...saved.data };
      if (saved.step && saved.step <= 4) { goToStep(saved.step); restoreFields(); }
    } catch(e) {}
  }
});

function saveProgress() {
  collectCurrentStep();
  chrome.storage.sync.set({ profile_onboarding: JSON.stringify({ step: currentStep, data: profileData }) });
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

    const dbName = data.dealership || null;
    if (dbName) {
      profileData.dealership.name = dbName;
      const nameInput = document.getElementById('s2-dealership') as HTMLInputElement;
      if (nameInput) { nameInput.value = dbName; nameInput.readOnly = true; nameInput.style.opacity = '0.7'; }
    }

    // Persist credentials returned by proxy. Clear any prior revocation flag.
    const toStore: Record<string, any> = {
      license_key: key,
      activated_at: Date.now(),
      license_revoked: false,
    };
    if (data.dealer_token) toStore.dealer_token = data.dealer_token;
    if (data.license_secret) toStore.license_secret = data.license_secret;
    if (dbName) toStore.dealership = dbName;
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
  chrome.storage.sync.set({
    'profile': JSON.stringify(profile),
    'profile_onboarded': true,
    'rep_name': profileData.identity.firstName + ' ' + profileData.identity.lastName,
    'dealership': profileData.dealership.name,
    'dealer_token': profileData.dealership.licenseKey
  }, () => {
    chrome.storage.sync.remove('profile_onboarding');
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

function openBrevmont() { window.close(); }

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

document.querySelectorAll('#s2-salt button').forEach(b => b.addEventListener('click', () => setSalt(b.textContent!.toLowerCase())));
document.querySelectorAll('#s3-emoji button').forEach(b => b.addEventListener('click', () => setEmoji(b.textContent!.toLowerCase())));
document.querySelectorAll('.tone-card[data-tone]').forEach(c => c.addEventListener('click', () => setTone(c as HTMLElement)));
document.querySelectorAll('[data-market]').forEach(c => c.addEventListener('click', () => setMarket(c as HTMLElement)));
document.querySelectorAll('.chip-toggle').forEach(c => c.addEventListener('click', () => toggleChip(c as HTMLElement)));
