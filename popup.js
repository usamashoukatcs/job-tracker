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

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function dayDiff(dateStr) {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

function buildAgenda(jobs) {
  const items = [];
  const label = j => `${j.title} — ${j.company}`;
  for (const j of jobs) {
    if (['archived', 'rejected', 'ghosted'].includes(j.status)) continue;
    if (j.interviewDate) {
      const d = dayDiff(j.interviewDate);
      if (d >= 0 && d <= 1) items.push({ d, icon: '🎙', text: `Interview: ${label(j)}` });
    }
    if (j.deadline) {
      const d = dayDiff(j.deadline);
      if (d >= 0 && d <= 2) items.push({ d, icon: '⏰', text: `Deadline: ${label(j)}` });
    }
    if (j.followupDate) {
      const d = dayDiff(j.followupDate);
      if (d >= -7 && d <= 1) items.push({ d, icon: '📌', text: `Follow up: ${label(j)}` });
    }
  }
  return items.sort((a, b) => a.d - b.d);
}

function renderAgenda(jobs) {
  const items = buildAgenda(jobs);
  const box = document.getElementById('agenda');
  if (!items.length) { box.style.display = 'none'; return; }
  const when = d => d < 0 ? `${-d}d late` : d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d}d`;
  document.getElementById('agendaList').innerHTML = items.slice(0, 6).map(it => `
    <div class="agenda-item" title="${escHtml(it.text)}">
      <span class="agenda-icon">${it.icon}</span>
      <span class="agenda-text">${escHtml(it.text)}</span>
      <span class="agenda-when ${it.d <= 0 ? 'now' : 'soon'}">${when(it.d)}</span>
    </div>`).join('') +
    (items.length > 6 ? `<div class="agenda-item" style="color:#64748b">+${items.length - 6} more in dashboard</div>` : '');
  box.style.display = '';
}

function renderJobs(jobs) {
  renderAgenda(jobs);
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
  document.getElementById('agendaList').addEventListener('click', openDashboard);
  load();
});
