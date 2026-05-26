const STATUS_LABELS = {
  applied: 'Applied', interview: 'Interview', rejected: 'Rejected',
  offer: 'Offer', ghosted: 'Ghosted', archived: 'Archived'
};
const STATUS_BADGE = {
  applied: 'badge-applied', interview: 'badge-interview', rejected: 'badge-rejected',
  offer: 'badge-offer', ghosted: 'badge-ghosted', archived: 'badge-ghosted'
};

function timeSince(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function initials(company) {
  return (company || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function renderJobs(jobs) {
  const applied   = jobs.filter(j => j.status === 'applied').length;
  const interview = jobs.filter(j => j.status === 'interview').length;
  const offer     = jobs.filter(j => j.status === 'offer').length;
  const rejected  = jobs.filter(j => j.status === 'rejected').length;

  document.getElementById('statApplied').textContent   = applied;
  document.getElementById('statInterview').textContent = interview;
  document.getElementById('statOffer').textContent     = offer;
  document.getElementById('statRejected').textContent  = rejected;

  const now      = Date.now();
  const settings = window._settings || {};
  const days     = settings.followUpDays || 7;

  const overdue = jobs.filter(j =>
    j.status === 'applied' &&
    !j.followUpSent &&
    j.applicationMethod === 'email' &&
    (now - new Date(j.appliedDate).getTime()) / 86400000 >= days
  );

  if (overdue.length > 0) {
    document.getElementById('followupCount').textContent   = overdue.length;
    document.getElementById('followupBanner').style.display = 'flex';
  }

  const list   = document.getElementById('jobList');
  const recent = jobs.slice(0, 7);

  if (recent.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📋</div>
        <div class="empty-text">No jobs tracked yet</div>
        <div class="empty-sub">Apply to a job and it'll appear here</div>
      </div>`;
    return;
  }

  list.innerHTML = recent.map(j => `
    <div class="job-item">
      <div class="job-avatar">${initials(j.company)}</div>
      <div class="job-info">
        <div class="job-title">${j.title}</div>
        <div class="job-company">${j.company}</div>
        <div class="job-meta">${timeSince(j.appliedDate)} · ${j.applicationMethod === 'email' ? '📧 email' : '🌐 online'}</div>
      </div>
      <div class="badge ${STATUS_BADGE[j.status] || 'badge-applied'}">${STATUS_LABELS[j.status] || j.status}</div>
    </div>
  `).join('');
}

async function load() {
  const [jobsRes, settingsRes] = await Promise.all([
    new Promise(r => chrome.runtime.sendMessage({ type: 'GET_JOBS' }, r)),
    new Promise(r => chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, r))
  ]);
  window._settings = settingsRes?.settings || {};
  renderJobs(jobsRes?.jobs || []);
}

async function openDashboard() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  window.close();
}

async function openSettings() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  window.close();
}

async function openAddJob() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html?add=1') });
  window.close();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('dashBtn').addEventListener('click', openDashboard);
  document.getElementById('addBtn').addEventListener('click', openAddJob);
  document.getElementById('addBtn2').addEventListener('click', openAddJob);
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('followupLink').addEventListener('click', openDashboard);
  load();
});
