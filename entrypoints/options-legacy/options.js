let profile = {};

function checkedTone() {
  return document.querySelector('input[name="tone"]:checked')?.value || 'professional';
}

function setTone(value) {
  const radio = document.querySelector(`input[name="tone"][value="${value || 'professional'}"]`);
  if (radio) radio.checked = true;
}

function readProfileState(cb) {
  chrome.storage.local.get(['profile', 'rep_name', 'brevmont_tone', 'brevmont_goal'], localD => {
    chrome.storage.sync.get(['profile', 'rep_name'], syncD => cb(localD || {}, syncD || {}));
  });
}

function render(localD, syncD) {
  try { profile = JSON.parse(localD.profile || syncD.profile || '{}') || {}; } catch { profile = {}; }
  const identity = profile.identity || {};
  const firstName = identity.firstName || String(localD.rep_name || syncD.rep_name || '').trim().split(/\s+/)[0] || '';
  document.getElementById('p-first').value = firstName;
  setTone(localD.brevmont_tone || 'professional');
  document.getElementById('p-goal').value = localD.brevmont_goal || 'close_deal';
}

async function save() {
  const firstName = document.getElementById('p-first').value.trim();
  profile.identity = { ...(profile.identity || {}), firstName };
  const payload = {
    profile: JSON.stringify(profile),
    brevmont_tone: checkedTone(),
    brevmont_goal: document.getElementById('p-goal').value || 'close_deal',
  };
  if (firstName) payload.rep_name = firstName;
  await chrome.storage.local.set(payload);
  await chrome.storage.sync.set(payload);
  const saved = document.getElementById('saved');
  saved.classList.add('show');
  setTimeout(() => saved.classList.remove('show'), 1800);
}

readProfileState(render);

chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'local' || area === 'sync') && ('profile' in changes || 'rep_name' in changes || 'brevmont_tone' in changes || 'brevmont_goal' in changes)) {
    readProfileState(render);
  }
});

document.getElementById('save-btn')?.addEventListener('click', () => void save());
