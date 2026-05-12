let profile = null;

// Read profile from both local and sync storage. local is the source of truth
// (instant, no replication lag), sync is a cross-device mirror. If either
// reports onboarded, render settings. This prevents the "No profile found"
// flash when a user who just completed onboarding opens the options page
// before chrome.storage.sync finishes replicating.
function readProfileState(cb) {
  chrome.storage.local.get(['profile', 'profile_onboarded'], localD => {
    if (localD && localD.profile_onboarded) { cb(localD); return; }
    chrome.storage.sync.get(['profile', 'profile_onboarded'], syncD => {
      cb(syncD && syncD.profile_onboarded ? syncD : localD || {});
    });
  });
}

function renderProfileState(d) {
  const noProfileEl = document.getElementById('no-profile');
  const bodyEl = document.getElementById('settings-body');
  if (!d || !d.profile_onboarded) {
    if (noProfileEl) noProfileEl.style.display = 'block';
    if (bodyEl) bodyEl.style.display = 'none';
    return;
  }
  if (noProfileEl) noProfileEl.style.display = 'none';
  try { profile = JSON.parse(d.profile); } catch(e) { profile = {}; }
  if (bodyEl) bodyEl.style.display = 'block';
  loadFields();
  renderPreview();
}

readProfileState(renderProfileState);

// Live-update when onboarding finishes in another tab (or this one).
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'local' || area === 'sync') && ('profile' in changes || 'profile_onboarded' in changes)) {
    readProfileState(renderProfileState);
  }
});

// Setup button
document.getElementById('setup-btn')?.addEventListener('click', () => {
  if (chrome.runtime.getURL) window.open(chrome.runtime.getURL('onboarding.html'));
});

function loadFields() {
  const id = profile.identity || {};
  const dl = profile.dealership || {};
  const vc = profile.voice || {};
  const mk = profile.market || {};
  document.getElementById('p-first').value = id.firstName || '';
  document.getElementById('p-last').value = id.lastName || '';
  document.getElementById('p-title').value = id.jobTitle || '';
  document.getElementById('p-years').value = id.yearsExperience || '';
  document.getElementById('p-dealer').value = dl.name || '';
  document.getElementById('p-city').value = dl.city || '';
  document.getElementById('p-state').value = dl.state || '';
  document.getElementById('p-license').value = dl.licenseKey || '';
  document.getElementById('p-crm').value = dl.crm || '';
  document.getElementById('p-docfee').value = dl.docFee || '';
  document.getElementById('p-tax').value = dl.taxRate || '';
  document.getElementById('p-salt').value = dl.saltRoads || 'no';
  document.getElementById('p-tone').value = vc.tone || '';
  document.getElementById('p-emojis').value = vc.emojis || '';
  document.getElementById('p-textsig').value = vc.textSignature || '';
  document.getElementById('p-emailsig').value = vc.emailSignoff || '';
  document.getElementById('p-langs').value = (vc.languages || []).join(', ');
  document.getElementById('p-philosophy').value = vc.philosophy || '';
  document.getElementById('p-custtypes').value = (mk.customerTypes || []).join(', ');
  document.getElementById('p-objections').value = (mk.objections || []).join(', ');
  document.getElementById('p-market').value = mk.marketType || '';
  document.getElementById('p-custnote').value = mk.customerNote || '';
}

function saveSection(section) {
  if (section === 'identity') {
    profile.identity.firstName = document.getElementById('p-first').value.trim();
    profile.identity.lastName = document.getElementById('p-last').value.trim();
    profile.identity.jobTitle = document.getElementById('p-title').value.trim();
    profile.identity.yearsExperience = document.getElementById('p-years').value.trim();
  } else if (section === 'dealership') {
    profile.dealership.name = document.getElementById('p-dealer').value.trim();
    profile.dealership.city = document.getElementById('p-city').value.trim();
    profile.dealership.state = document.getElementById('p-state').value.trim();
    profile.dealership.licenseKey = document.getElementById('p-license').value.trim();
    profile.dealership.crm = document.getElementById('p-crm').value.trim();
    profile.dealership.docFee = document.getElementById('p-docfee').value.trim();
    profile.dealership.taxRate = document.getElementById('p-tax').value.trim();
  } else if (section === 'voice') {
    profile.voice.tone = document.getElementById('p-tone').value.trim();
    profile.voice.emojis = document.getElementById('p-emojis').value.trim();
    profile.voice.textSignature = document.getElementById('p-textsig').value.trim();
    profile.voice.emailSignoff = document.getElementById('p-emailsig').value.trim();
    profile.voice.philosophy = document.getElementById('p-philosophy').value.trim();
  } else if (section === 'market') {
    profile.market.marketType = document.getElementById('p-market').value.trim();
    profile.market.customerNote = document.getElementById('p-custnote').value.trim();
  }

  chrome.storage.sync.set({
    profile: JSON.stringify(profile),
    rep_name: (profile.identity.firstName + ' ' + profile.identity.lastName).trim(),
    dealership: profile.dealership.name,
    dealer_token: profile.dealership.licenseKey
  }, () => {
    const el = document.getElementById('save-' + section);
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2000);
    renderPreview();
  });
}

function renderPreview() {
  const id = profile.identity || {};
  const dl = profile.dealership || {};
  const vc = profile.voice || {};
  const mk = profile.market || {};
  let ctx = 'REP PROFILE:\n';
  ctx += `Name: ${id.firstName || ''} ${id.lastName || ''}\n`;
  if (id.jobTitle) ctx += `Title: ${id.jobTitle}\n`;
  if (id.yearsExperience) ctx += `Experience: ${id.yearsExperience}\n`;
  ctx += `Dealership: ${dl.name || ''}\n`;
  if (dl.city && dl.state) ctx += `Location: ${dl.city}, ${dl.state}\n`;
  if (dl.crm) ctx += `CRM: ${dl.crm}\n`;
  if (mk.marketType) ctx += `Market type: ${mk.marketType}\n`;
  if (dl.saltRoads) ctx += `Road salting: ${dl.saltRoads}\n`;
  if (dl.docFee) ctx += `Doc fee: $${dl.docFee}\n`;
  if (dl.taxRate) ctx += `Tax rate: ${dl.taxRate}%\n`;
  ctx += '\nCOMMUNICATION STYLE:\n';
  if (vc.tone) ctx += `Tone: ${vc.tone}\n`;
  if (vc.emojis) ctx += `Emojis: ${vc.emojis}\n`;
  if (vc.textSignature) ctx += `Text signature: ${vc.textSignature}\n`;
  if (vc.emailSignoff) ctx += `Email sign-off: ${vc.emailSignoff}\n`;
  if (vc.languages?.length) ctx += `Languages: ${vc.languages.join(', ')}\n`;
  if (vc.philosophy) ctx += `Selling philosophy: ${vc.philosophy}\n`;
  if (mk.customerTypes?.length || mk.objections?.length || mk.customerNote) {
    ctx += '\nCUSTOMER CONTEXT:\n';
    if (mk.customerTypes?.length) ctx += `Customer types: ${mk.customerTypes.join(', ')}\n`;
    if (mk.objections?.length) ctx += `Common objections: ${mk.objections.join(', ')}\n`;
    if (mk.customerNote) ctx += `Market notes: ${mk.customerNote}\n`;
  }
  document.getElementById('ctx-preview').textContent = ctx;
}

function toggleSection(header) {
  const body = header.nextElementSibling;
  const arrow = header.querySelector('.arrow');
  body.classList.toggle('open');
  arrow.classList.toggle('open');
}

// Wire up all section headers and save buttons via addEventListener (no inline onclick)
document.querySelectorAll('.section-header').forEach(header => {
  header.addEventListener('click', () => toggleSection(header));
});
document.querySelectorAll('.save-btn').forEach(btn => {
  btn.addEventListener('click', () => saveSection(btn.dataset.section));
});
