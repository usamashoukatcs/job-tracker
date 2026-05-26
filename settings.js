let settings = {};

function send(type, extra = {}) {
  return new Promise(r => chrome.runtime.sendMessage({ type, ...extra }, r));
}

async function load() {
  const res = await send('GET_SETTINGS');
  settings = res?.settings || {};

  document.getElementById('claudeKey').value     = settings.claudeApiKey || '';
  document.getElementById('googleClientId').value = settings.googleClientId || '';
  document.getElementById('followUpDays').value   = String(settings.followUpDays ?? 7);
  updateGmailToggle(settings.gmailEnabled);
  updateClaudeStatus(!!settings.claudeApiKey);
  updateGmailStatus(settings.gmailEnabled);

  const urlRes = await send('GET_REDIRECT_URL');
  if (urlRes?.url) document.getElementById('redirectUri').textContent = urlRes.url;

  const syncRes = await new Promise(r => chrome.storage.local.get('gmailLastSync', r));
  if (syncRes.gmailLastSync) {
    document.getElementById('gmailStatus').textContent = `Last synced: ${new Date(syncRes.gmailLastSync).toLocaleString()}`;
    document.getElementById('gmailDot').classList.add('ok');
    document.getElementById('syncNowBtn').style.display = 'inline-block';
  }
}

function updateClaudeStatus(ok) {
  document.getElementById('claudeDot').className   = 'status-dot ' + (ok ? 'ok' : '');
  document.getElementById('claudeStatus').textContent = ok ? 'API key configured' : 'Not configured';
}

function updateGmailToggle(on) {
  document.getElementById('gmailToggle').className = 'toggle ' + (on ? 'on' : '');
}

function updateGmailStatus(enabled) {
  if (enabled) document.getElementById('gmailDot').className = 'status-dot ok';
}

function toggleGmail() {
  settings.gmailEnabled = !settings.gmailEnabled;
  updateGmailToggle(settings.gmailEnabled);
}

async function testClaude() {
  const key = document.getElementById('claudeKey').value.trim();
  if (!key) { showToast('Enter your API key first'); return; }

  const btn = document.getElementById('testClaude');
  btn.textContent = 'Testing…';
  btn.disabled    = true;

  await send('SAVE_SETTINGS', { settings: { ...settings, claudeApiKey: key } });

  const res = await send('GET_AI_ANSWER', {
    question: 'Why do you want to work here?',
    context:  'Software Engineer at Test Company'
  });

  btn.textContent = 'Test Key';
  btn.disabled    = false;

  if (res?.answer && !res.answer.startsWith('Error') && !res.answer.startsWith('Please add')) {
    updateClaudeStatus(true);
    showToast('✓ Claude API key works!');
  } else {
    updateClaudeStatus(false);
    showToast('✗ API key error: ' + (res?.answer || 'unknown'));
  }
}

async function connectGmail() {
  const clientId = document.getElementById('googleClientId').value.trim();
  if (!clientId) {
    showToast('Enter your Google Client ID first');
    document.getElementById('gmailSteps').style.display = 'block';
    return;
  }

  await send('SAVE_SETTINGS', { settings: { ...collectSettings(), googleClientId: clientId } });

  const btn = document.getElementById('connectGmailBtn');
  btn.textContent = 'Connecting…';
  btn.disabled    = true;

  const res = await send('CONNECT_GMAIL');
  btn.textContent = 'Connect Gmail Account';
  btn.disabled    = false;

  if (res?.ok) {
    settings.gmailEnabled = true;
    updateGmailToggle(true);
    document.getElementById('gmailDot').className   = 'status-dot ok';
    document.getElementById('gmailStatus').textContent = 'Connected — syncs every 15 minutes';
    document.getElementById('syncNowBtn').style.display = 'inline-block';
    showToast('✓ Gmail connected!');
  } else {
    showToast('Could not connect. Check your Client ID and try again.');
  }
}

async function syncNow() {
  const btn = document.getElementById('syncNowBtn');
  btn.textContent = 'Syncing…';
  btn.disabled    = true;
  await send('SYNC_GMAIL_NOW');
  btn.textContent = '🔄 Sync Now';
  btn.disabled    = false;
  showToast('Gmail sync complete');
}

function collectSettings() {
  return {
    claudeApiKey:   document.getElementById('claudeKey').value.trim(),
    googleClientId: document.getElementById('googleClientId').value.trim(),
    followUpDays:   parseInt(document.getElementById('followUpDays').value),
    gmailEnabled:   settings.gmailEnabled || false
  };
}

async function saveSettings() {
  const newSettings = collectSettings();
  await send('SAVE_SETTINGS', { settings: newSettings });
  settings = newSettings;
  updateClaudeStatus(!!newSettings.claudeApiKey);
  showToast('✓ Settings saved');
}

async function clearAllData() {
  if (!confirm('Delete ALL tracked jobs? This cannot be undone.')) return;
  await new Promise(r => chrome.storage.local.remove('jobs', r));
  showToast('All job data cleared');
}

function showToast(msg) {
  const old = document.getElementById('toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.id = 'toast';
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('backBtn').addEventListener('click', () => history.back());
  document.getElementById('cancelBtn').addEventListener('click', () => history.back());
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('testClaude').addEventListener('click', testClaude);
  document.getElementById('gmailToggle').addEventListener('click', toggleGmail);
  document.getElementById('showGmailSteps').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('gmailSteps').style.display = 'block';
  });
  document.getElementById('connectGmailBtn').addEventListener('click', connectGmail);
  document.getElementById('syncNowBtn').addEventListener('click', syncNow);
  document.getElementById('clearDataBtn').addEventListener('click', clearAllData);
  load();
});
