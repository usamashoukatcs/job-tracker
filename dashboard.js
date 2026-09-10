// Apply saved dark mode before any rendering to avoid flash
(function () {
  const saved = localStorage.getItem('darkMode');
  if (saved) document.body.setAttribute('data-theme', saved);
})();

let allJobs = [];
let settings = {};
let currentFilter = 'all';
let currentSearch = '';
let followupJobId = null;
let viewMode = 'list';
let trackerSort = 'date-desc';

const BACKEND = 'http://localhost:8080';
let finderJobs = [];
let finderPollInterval = null;
let finderView = 'jobs'; // 'jobs' or 'posts'
let finderSourceFilter = 'all';
let finderSort = 'score';
let finderScoreMin = 0;
let finderSearch = '';
const trackedFinderUrls = new Set();
const visitedFinderUrls = new Set(JSON.parse(localStorage.getItem('visitedFinderUrls') || '[]'));
const hiddenFinderIds = new Set(JSON.parse(localStorage.getItem('hiddenFinderIds') || '[]'));
const savedFinderIds  = new Set(JSON.parse(localStorage.getItem('savedFinderIds')  || '[]'));

const DEFAULT_KEYWORDS = [
  'backend engineer',
  'software engineer',
  'backend developer',
  'platform engineer',
].join('\n');

const STATUS_BADGE = {
  applied: 'badge-applied', interview: 'badge-interview', rejected: 'badge-rejected',
  offer: 'badge-offer', ghosted: 'badge-ghosted', archived: 'badge-archived'
};

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 2900);
}

function toggleDarkMode() {
  const isDark = document.body.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  document.body.setAttribute('data-theme', next);
  localStorage.setItem('darkMode', next);
  document.getElementById('darkModeBtn').textContent = next === 'dark' ? '☀️' : '🌙';
}

function exportCsv() {
  if (!allJobs.length) { showToast('No jobs to export yet.', 'error'); return; }
  const headers = ['Title', 'Company', 'Status', 'Applied Date', 'Method', 'URL', 'Notes'];
  const rows = allJobs.map(j => [
    j.title || '',
    j.company || '',
    j.status || '',
    j.appliedDate ? new Date(j.appliedDate).toLocaleDateString('en-US') : '',
    j.applicationMethod || '',
    j.url || '',
    (j.notes || '').replace(/\r?\n/g, ' '),
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `job-applications-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function initials(company) {
  return (company || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function send(type, extra = {}) {
  return new Promise(r => chrome.runtime.sendMessage({ type, ...extra }, r));
}

// ── Filter ───────────────────────────────────────────────────────────────────

function setFilter(f, clickedEl) {
  currentFilter = f;
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.stat-card').forEach(t => t.classList.remove('active'));
  if (clickedEl) clickedEl.classList.add('active');
  renderJobs();
}

function getFiltered() {
  let jobs = [...allJobs];
  if (currentFilter !== 'all') {
    if (currentFilter === 'email') jobs = jobs.filter(j => j.applicationMethod === 'email');
    else jobs = jobs.filter(j => j.status === currentFilter);
  }
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    jobs = jobs.filter(j =>
      j.title.toLowerCase().includes(q) ||
      j.company.toLowerCase().includes(q) ||
      (j.notes || '').toLowerCase().includes(q)
    );
  }
  const STATUS_ORDER = { offer: 0, interview: 1, applied: 2, ghosted: 3, rejected: 4, archived: 5 };
  switch (trackerSort) {
    case 'date-asc':  jobs.sort((a, b) => new Date(a.appliedDate) - new Date(b.appliedDate)); break;
    case 'company':   jobs.sort((a, b) => (a.company || '').localeCompare(b.company || '')); break;
    case 'status':    jobs.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)); break;
    default:          jobs.sort((a, b) => new Date(b.appliedDate) - new Date(a.appliedDate)); break;
  }
  return jobs;
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderStats() {
  document.getElementById('sAll').textContent      = allJobs.length;
  document.getElementById('sApplied').textContent  = allJobs.filter(j => j.status === 'applied').length;
  document.getElementById('sInterview').textContent = allJobs.filter(j => j.status === 'interview').length;
  document.getElementById('sOffer').textContent    = allJobs.filter(j => j.status === 'offer').length;
  document.getElementById('sRejected').textContent = allJobs.filter(j => j.status === 'rejected').length;
  document.getElementById('sGhosted').textContent  = allJobs.filter(j => j.status === 'ghosted').length;
}

function renderFollowUps() {
  const days    = settings.followUpDays || 7;
  const overdue = allJobs.filter(j =>
    j.status === 'applied' && !j.followUpSent &&
    j.applicationMethod === 'email' && daysSince(j.appliedDate) >= days
  );

  const sec  = document.getElementById('followupSection');
  const list = document.getElementById('followupJobs');
  if (overdue.length === 0) { sec.style.display = 'none'; return; }
  sec.style.display = 'block';

  list.innerHTML = overdue.map(j => `
    <div class="followup-job-item">
      <div class="info">
        <strong>${j.title} — ${j.company}</strong>
        <small>Applied ${daysSince(j.appliedDate)} days ago · ${j.contactEmail || 'no email saved'}</small>
      </div>
      <button class="followup-btn" data-followup-id="${j.id}">Draft Follow-up</button>
    </div>
  `).join('');
}

function renderKanban() {
  const COLS = [
    { status: 'applied',   label: 'Applied',   dot: '#2563eb' },
    { status: 'interview', label: 'Interview',  dot: '#16a34a' },
    { status: 'offer',     label: 'Offer',      dot: '#d97706' },
    { status: 'rejected',  label: 'Rejected',   dot: '#dc2626' },
    { status: 'ghosted',   label: 'Ghosted',    dot: '#94a3b8' },
  ];

  const search = currentSearch.toLowerCase();
  const board = document.getElementById('kanbanBoard');

  board.innerHTML = COLS.map(col => {
    let jobs = allJobs.filter(j => j.status === col.status);
    if (search) {
      jobs = jobs.filter(j =>
        j.title.toLowerCase().includes(search) ||
        j.company.toLowerCase().includes(search) ||
        (j.notes || '').toLowerCase().includes(search)
      );
    }

    const cards = jobs.length === 0
      ? `<div class="kanban-empty">No jobs</div>`
      : jobs.map(j => {
          const days = daysSince(j.appliedDate);
          const daysLabel = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days}d ago`;
          return `
            <div class="kanban-card" data-job-id="${j.id}">
              <div class="kanban-card-top">
                <div class="kanban-card-title">${j.title}</div>
              </div>
              <div class="kanban-card-company">${j.company}</div>
              <div class="kanban-card-footer">
                <span class="kanban-card-days">📅 ${daysLabel}</span>
                <select data-action="status" data-job-id="${j.id}">
                  <option value="">Move →</option>
                  <option value="applied">Applied</option>
                  <option value="interview">Interview</option>
                  <option value="offer">Offer</option>
                  <option value="rejected">Rejected</option>
                  <option value="ghosted">Ghosted</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>`;
        }).join('');

    return `
      <div class="kanban-col">
        <div class="kanban-col-header">
          <span class="col-label">
            <span style="width:9px;height:9px;border-radius:50%;background:${col.dot};display:inline-block"></span>
            ${col.label}
          </span>
          <span class="kanban-count">${jobs.length}</span>
        </div>
        <div class="kanban-cards">${cards}</div>
      </div>`;
  }).join('');
}

function setViewMode(mode) {
  viewMode = mode;
  document.getElementById('viewList').classList.toggle('active', mode === 'list');
  document.getElementById('viewKanban').classList.toggle('active', mode === 'kanban');
  document.getElementById('jobsGrid').style.display    = mode === 'list'   ? '' : 'none';
  document.getElementById('kanbanBoard').style.display = mode === 'kanban' ? '' : 'none';
  if (mode === 'kanban') renderKanban(); else renderJobs();
}

function renderJobs() {
  const jobs = getFiltered();
  const grid = document.getElementById('jobsGrid');

  if (jobs.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">📋</div>
        <div class="es-text">No jobs here yet</div>
        <div class="es-sub">Try a different filter, or click "+ Add Job" to add one manually</div>
      </div>`;
    return;
  }

  grid.innerHTML = jobs.map(j => {
    const events   = (j.events || []).slice(-3).reverse();
    const daysAgo  = daysSince(j.appliedDate);
    const followupDue = j.applicationMethod === 'email' && j.status === 'applied' &&
      !j.followUpSent && daysAgo >= (settings.followUpDays || 7);

    const timeline = events.map(e => `
      <div class="timeline-item">
        <div class="tl-dot ${e.type}"></div>
        <div class="tl-date">${fmtDate(e.date)}</div>
        <div class="tl-note">${e.note || e.type}</div>
      </div>`).join('');

    const methodIcon = j.applicationMethod === 'email' ? '📧 email'
      : j.applicationMethod === 'linkedin' ? '🔗 linkedin'
      : j.applicationMethod === 'referral' ? '🤝 referral'
      : '🌐 online';

    return `
      <div class="job-card" id="card-${j.id}" data-job-id="${j.id}">
        <div class="card-header">
          <div class="card-avatar">${initials(j.company)}</div>
          <div class="card-main">
            <div class="card-title">${j.title}</div>
            <div class="card-company">${j.company}</div>
          </div>
          <div class="card-badge">
            <span class="badge ${STATUS_BADGE[j.status] || 'badge-applied'}">${j.status}</span>
          </div>
        </div>

        <div class="card-body">
          <div class="card-meta">
            <div class="meta-item">📅 ${fmtDate(j.appliedDate)}</div>
            <div class="meta-item">${methodIcon}</div>
            ${j.url ? `<div class="meta-item"><a href="${j.url}" target="_blank" style="color:#2563eb;text-decoration:none">🔗 View Job</a></div>` : ''}
          </div>
          ${followupDue ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:7px 10px;font-size:12px;color:#92400e;margin-bottom:10px">⏰ Follow-up overdue — ${daysAgo} days with no response</div>` : ''}
          ${j.notes ? `<div class="card-notes">${j.notes}</div>` : ''}
          ${events.length > 0 ? `<div class="timeline"><div class="timeline-title">History</div>${timeline}</div>` : ''}
        </div>

        <div class="card-actions">
          <button class="card-btn" data-action="edit" data-job-id="${j.id}">✏ Edit</button>
          <select class="card-btn" data-action="status" data-job-id="${j.id}" style="cursor:pointer">
            <option value="">Status →</option>
            <option value="applied">Applied</option>
            <option value="interview">Interview</option>
            <option value="offer">Offer</option>
            <option value="rejected">Rejected</option>
            <option value="ghosted">Ghosted</option>
            <option value="archived">Archived</option>
          </select>
          ${j.applicationMethod === 'email' ? `<button class="card-btn" data-action="followup" data-job-id="${j.id}">📧 Follow-up</button>` : ''}
          <a class="card-btn" href="https://www.glassdoor.com/Search/results.htm?keyword=${encodeURIComponent(j.company)}" target="_blank" title="Glassdoor reviews" style="text-decoration:none;display:flex;align-items:center;justify-content:center">🌟</a>
          <a class="card-btn" href="https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(j.company)}" target="_blank" title="LinkedIn company" style="text-decoration:none;display:flex;align-items:center;justify-content:center">🔗</a>
          <button class="card-btn danger" data-action="delete" data-job-id="${j.id}">🗑</button>
        </div>
      </div>`;
  }).join('');
}

// ── Job actions ──────────────────────────────────────────────────────────────

async function quickStatus(id, status) {
  await send('UPDATE_JOB', { id, updates: { status } });
  await reload();
}

async function deleteJob(id) {
  if (!confirm('Delete this job from your tracker?')) return;
  await send('DELETE_JOB', { id });
  await reload();
}

function openAddModal(prefill) {
  document.getElementById('editId').value      = '';
  document.getElementById('modalTitle').textContent = 'Add Job';
  document.getElementById('fTitle').value      = prefill?.title || '';
  document.getElementById('fCompany').value    = prefill?.company || '';
  document.getElementById('fUrl').value        = prefill?.url || '';
  document.getElementById('fStatus').value     = 'applied';
  document.getElementById('fMethod').value     = 'online';
  document.getElementById('fDate').value       = new Date().toISOString().split('T')[0];
  document.getElementById('fEmail').value      = '';
  document.getElementById('fNotes').value      = '';
  document.getElementById('addModal').style.display = 'flex';
}

function editJob(id) {
  const j = allJobs.find(j => j.id === id);
  if (!j) return;
  document.getElementById('editId').value      = j.id;
  document.getElementById('modalTitle').textContent = 'Edit Job';
  document.getElementById('fTitle').value      = j.title;
  document.getElementById('fCompany').value    = j.company;
  document.getElementById('fUrl').value        = j.url || '';
  document.getElementById('fStatus').value     = j.status;
  document.getElementById('fMethod').value     = j.applicationMethod || 'online';
  document.getElementById('fDate').value       = j.appliedDate ? j.appliedDate.split('T')[0] : '';
  document.getElementById('fEmail').value      = j.contactEmail || '';
  document.getElementById('fNotes').value      = j.notes || '';
  document.getElementById('addModal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('addModal').style.display = 'none';
}

async function saveJob() {
  const id      = document.getElementById('editId').value;
  const title   = document.getElementById('fTitle').value.trim();
  const company = document.getElementById('fCompany').value.trim();
  if (!title || !company) { showToast('Title and company are required.', 'error'); return; }

  const data = {
    title, company,
    url:               document.getElementById('fUrl').value.trim(),
    status:            document.getElementById('fStatus').value,
    applicationMethod: document.getElementById('fMethod').value,
    appliedDate: document.getElementById('fDate').value
      ? new Date(document.getElementById('fDate').value).toISOString()
      : new Date().toISOString(),
    contactEmail: document.getElementById('fEmail').value.trim(),
    notes:        document.getElementById('fNotes').value.trim()
  };

  if (id) await send('UPDATE_JOB', { id, updates: data });
  else    await send('ADD_JOB', { job: data });

  closeModal();
  await reload();
}

// ── Follow-up ────────────────────────────────────────────────────────────────

function openFollowupModal(jobId) {
  const j = allJobs.find(j => j.id === jobId);
  if (!j) return;
  followupJobId = jobId;

  document.getElementById('followupJobName').textContent = `${j.title} at ${j.company}`;
  document.getElementById('followupTo').value = j.contactEmail || '';

  const d     = daysSince(j.appliedDate);
  const draft = `Hi,\n\nI wanted to follow up on my application for the ${j.title} position that I submitted ${d} days ago.\n\nI'm still very interested in this role and would love the opportunity to discuss how my background could be a good fit for your team.\n\nPlease let me know if there's any additional information I can provide or if you'd like to schedule a time to connect.\n\nThank you for your time.\n\nBest regards`;

  document.getElementById('followupDraft').value = draft;
  document.getElementById('followupModal').style.display = 'flex';
}

function closeFollowupModal() {
  document.getElementById('followupModal').style.display = 'none';
  followupJobId = null;
}

function copyDraft() {
  navigator.clipboard.writeText(document.getElementById('followupDraft').value)
    .then(() => showToast('Copied to clipboard!', 'success'));
}

function openMailto() {
  const to      = document.getElementById('followupTo').value;
  const body    = encodeURIComponent(document.getElementById('followupDraft').value);
  const j       = allJobs.find(j => j.id === followupJobId);
  const subject = encodeURIComponent(`Following Up — ${j?.title || 'Application'}`);
  window.open(`mailto:${to}?subject=${subject}&body=${body}`);
}

async function markFollowupSent() {
  if (followupJobId) {
    await send('UPDATE_JOB', { id: followupJobId, updates: { followUpSent: true } });
    await reload();
  }
  closeFollowupModal();
}

// ── Reload ───────────────────────────────────────────────────────────────────

async function reload() {
  const [jobsRes, settingsRes] = await Promise.all([
    send('GET_JOBS'),
    send('GET_SETTINGS')
  ]);
  allJobs  = jobsRes?.jobs || [];
  settings = settingsRes?.settings || {};
  renderStats();
  renderFollowUps();
  if (viewMode === 'kanban') renderKanban(); else renderJobs();
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // Dark mode + export topbar buttons
  const savedTheme = localStorage.getItem('darkMode') || 'light';
  document.getElementById('darkModeBtn').textContent = savedTheme === 'dark' ? '☀️' : '🌙';
  document.getElementById('darkModeBtn').addEventListener('click', toggleDarkMode);
  document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);

  // Topbar buttons
  document.getElementById('settingsNavBtn').addEventListener('click', () => {
    location.href = 'settings.html';
  });
  document.getElementById('addJobBtn').addEventListener('click', () => openAddModal());

  // Stat cards (event delegation by data-filter)
  document.getElementById('statsRow').addEventListener('click', e => {
    const card = e.target.closest('.stat-card[data-filter]');
    if (card) setFilter(card.dataset.filter, card);
  });

  // Filter tabs (event delegation by data-filter)
  document.querySelector('.filter-row').addEventListener('click', e => {
    const tab = e.target.closest('.filter-tab[data-filter]');
    if (tab) setFilter(tab.dataset.filter, tab);
  });

  // Job grid: click delegation (edit, delete, followup)
  document.getElementById('jobsGrid').addEventListener('click', e => {
    const btn   = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const jobId  = btn.dataset.jobId || btn.closest('[data-job-id]')?.dataset.jobId;
    if (action === 'edit')     editJob(jobId);
    if (action === 'delete')   deleteJob(jobId);
    if (action === 'followup') openFollowupModal(jobId);
  });

  // Job grid: status select delegation
  document.getElementById('jobsGrid').addEventListener('change', e => {
    const sel = e.target.closest('[data-action="status"]');
    if (!sel || !sel.value) return;
    const jobId = sel.dataset.jobId || sel.closest('[data-job-id]')?.dataset.jobId;
    if (jobId) quickStatus(jobId, sel.value);
  });

  // Follow-up section
  document.getElementById('followupJobs').addEventListener('click', e => {
    const btn = e.target.closest('[data-followup-id]');
    if (btn) openFollowupModal(btn.dataset.followupId);
  });

  // Add/edit modal
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
  document.getElementById('saveJobBtn').addEventListener('click', saveJob);
  document.getElementById('addModal').addEventListener('click', e => {
    if (e.target === document.getElementById('addModal')) closeModal();
  });

  // Follow-up modal
  document.getElementById('closeFollowupBtn').addEventListener('click', closeFollowupModal);
  document.getElementById('cancelFollowupBtn').addEventListener('click', closeFollowupModal);
  document.getElementById('copyDraftBtn').addEventListener('click', copyDraft);
  document.getElementById('openMailtoBtn').addEventListener('click', openMailto);
  document.getElementById('markSentBtn').addEventListener('click', markFollowupSent);
  document.getElementById('followupModal').addEventListener('click', e => {
    if (e.target === document.getElementById('followupModal')) closeFollowupModal();
  });

  // Search
  document.getElementById('searchInput').addEventListener('input', e => {
    currentSearch = e.target.value.trim();
    if (viewMode === 'kanban') renderKanban(); else renderJobs();
  });

  // View toggle + sort
  document.getElementById('viewList').addEventListener('click',   () => setViewMode('list'));
  document.getElementById('viewKanban').addEventListener('click', () => setViewMode('kanban'));
  document.getElementById('trackerSort').addEventListener('change', e => {
    trackerSort = e.target.value;
    if (viewMode === 'kanban') renderKanban(); else renderJobs();
  });

  // Kanban status selects (event delegation on the board)
  document.getElementById('kanbanBoard').addEventListener('change', e => {
    const sel = e.target.closest('[data-action="status"]');
    if (!sel || !sel.value) return;
    const jobId = sel.dataset.jobId;
    if (jobId) quickStatus(jobId, sel.value);
  });

  // Auto-open add modal if ?add=1
  if (location.search.includes('add=1')) openAddModal();

  // Main tab switching
  document.getElementById('tabTracker').addEventListener('click', () => switchTab('tracker'));
  document.getElementById('tabFinder').addEventListener('click',  () => switchTab('finder'));

  // Weekly goal input
  document.getElementById('goalInput').addEventListener('change', e => {
    const v = Math.max(1, parseInt(e.target.value, 10) || 5);
    e.target.value = v;
    localStorage.setItem('weeklyGoal', v);
    renderGoal();
  });

  // Stats tab
  document.getElementById('tabStats').addEventListener('click', () => switchTab('stats'));

  // Finder view toggle (Jobs / LinkedIn Posts / Saved)
  document.getElementById('finderViewJobs').addEventListener('click',  () => setFinderView('jobs'));
  document.getElementById('finderViewPosts').addEventListener('click', () => setFinderView('posts'));
  document.getElementById('finderViewSaved').addEventListener('click', () => setFinderView('saved'));

  // Finder text search
  document.getElementById('finderSearch').addEventListener('input', e => {
    finderSearch = e.target.value.trim();
    renderFinderJobs();
  });

  // Finder source filter chips
  document.getElementById('finderFilterRow').addEventListener('click', e => {
    const chip = e.target.closest('[data-src]');
    if (!chip) return;
    finderSourceFilter = chip.dataset.src;
    document.querySelectorAll('[data-src]').forEach(c =>
      c.classList.toggle('active', c === chip));
    renderFinderJobs();
  });

  // Finder score min filter
  document.getElementById('finderScoreFilter').addEventListener('change', e => {
    finderScoreMin = parseInt(e.target.value, 10) || 0;
    renderFinderJobs();
  });

  // Finder sort
  document.getElementById('finderSort').addEventListener('change', e => {
    finderSort = e.target.value;
    renderFinderJobs();
  });

  // Finder settings panel
  document.getElementById('toggleSettingsBtn').addEventListener('click', () => {
    const panel = document.getElementById('searchSettingsPanel');
    const open  = panel.style.display === 'none';
    panel.style.display = open ? '' : 'none';
    document.getElementById('toggleSettingsBtn').textContent = open ? '⚙ Settings ▲' : '⚙ Settings';
    if (open) loadSettingsIntoPanel();
  });
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSearchSettings);

  // Finder
  document.getElementById('searchJobsBtn').addEventListener('click', searchJobs);
  document.getElementById('finderGrid').addEventListener('click', async e => {
    // Save for later
    const saveBtn = e.target.closest('[data-finder-save]');
    if (saveBtn) {
      const id = saveBtn.dataset.finderSave;
      if (savedFinderIds.has(id)) {
        savedFinderIds.delete(id);
      } else {
        savedFinderIds.add(id);
      }
      localStorage.setItem('savedFinderIds', JSON.stringify([...savedFinderIds]));
      renderFinderJobs();
      return;
    }

    // Hide / Not Interested
    const hideBtn = e.target.closest('[data-finder-hide]');
    if (hideBtn) {
      const id = hideBtn.dataset.finderHide;
      hiddenFinderIds.add(id);
      localStorage.setItem('hiddenFinderIds', JSON.stringify([...hiddenFinderIds]));
      hideBtn.closest('.job-card').remove();
      return;
    }

    const viewBtn = e.target.closest('[data-action="view-job"]');
    if (viewBtn) {
      const url = viewBtn.dataset.url;
      if (url) window.open(url, '_blank');
      visitedFinderUrls.add(url);
      localStorage.setItem('visitedFinderUrls', JSON.stringify([...visitedFinderUrls]));
      const card = viewBtn.closest('.job-card');
      if (card) {
        card.classList.add('finder-visited');
        card.classList.remove('finder-new');
        const badges = card.querySelector('.card-badges');
        if (badges) {
          const newBadge = [...badges.querySelectorAll('span')].find(s => s.textContent.includes('New'));
          if (newBadge) newBadge.remove();
        }
        if (badges && !badges.querySelector('.visited-badge') && !badges.querySelector('.tracking-badge')) {
          const badge = document.createElement('span');
          badge.className = 'visited-badge';
          badge.style.cssText = 'font-size:10px;font-weight:700;color:#6366f1;background:#ede9fe;padding:2px 7px;border-radius:10px;white-space:nowrap';
          badge.textContent = '👁 Visited';
          badges.appendChild(badge);
        }
      }
    }

    const btn = e.target.closest('[data-finder-track]');
    if (!btn || btn.disabled) return;
    const job = finderJobs.find(j => j.id === btn.dataset.finderTrack);
    if (!job) return;
    btn.disabled = true;
    btn.textContent = '…';
    // Re-fetch latest jobs before adding to catch any auto-tracked entries since last load
    const freshRes = await send('GET_JOBS');
    allJobs = freshRes?.jobs || allJobs;
    const normUrl = u => (u || '').split('#')[0].split('?')[0].replace(/\/$/, '').toLowerCase();
    const alreadyTracked = allJobs.some(j => j.url && normUrl(j.url) === normUrl(job.url));
    if (alreadyTracked) {
      btn.textContent = '✓ Tracked';
      btn.classList.add('tracked-btn');
      return;
    }
    await new Promise(resolve =>
      chrome.runtime.sendMessage({
        type: 'ADD_JOB',
        job: {
          title: job.title,
          company: job.company,
          url: job.url,
          applicationMethod: 'online',
          status: 'applied',
          notes: job.matchedSkills?.length ? `Matched: ${job.matchedSkills.join(', ')}` : ''
        }
      }, resolve)
    );
    trackedFinderUrls.add(job.url);
    btn.textContent = '✓ Tracked';
    btn.classList.add('tracked-btn');
    const card = btn.closest('.job-card');
    if (card) {
      card.classList.remove('finder-visited');
      const visitedBadge = card.querySelector('.visited-badge');
      if (visitedBadge) visitedBadge.remove();
      const badges = card.querySelector('.card-badges');
      if (badges && !badges.querySelector('.tracking-badge')) {
        const tb = document.createElement('span');
        tb.className = 'tracking-badge';
        tb.style.cssText = 'font-size:10px;font-weight:700;color:#16a34a;background:#dcfce7;padding:2px 7px;border-radius:10px;white-space:nowrap';
        tb.textContent = '✓ Tracking';
        badges.appendChild(tb);
      }
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    // Ignore when typing in an input/textarea/select
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    // Ignore when a modal is open
    const modalOpen = document.getElementById('addModal').style.display !== 'none'
      || document.getElementById('followupModal').style.display !== 'none';

    switch (e.key) {
      case '1': switchTab('tracker'); break;
      case '2': switchTab('finder');  break;
      case '3': switchTab('stats');   break;
      case 'a': if (!modalOpen) openAddModal(); break;
      case '/':
        e.preventDefault();
        if (!modalOpen) {
          const activeTab = document.getElementById('tabFinder').classList.contains('active');
          if (activeTab) document.getElementById('finderSearch')?.focus();
          else           document.getElementById('searchInput')?.focus();
        }
        break;
      case 'Escape':
        closeModal();
        closeFollowupModal();
        break;
    }
  });

  reload();
});

// ── Search settings (persisted to localStorage) ──────────────────────────────

function loadSearchSettings() {
  return {
    keywords: (localStorage.getItem('finderKeywords') || DEFAULT_KEYWORDS)
      .split('\n').map(s => s.trim()).filter(Boolean),
    customUrls: (localStorage.getItem('finderCustomUrls') || '')
      .split('\n').map(s => s.trim()).filter(Boolean),
    customWebsites: (localStorage.getItem('finderCustomWebsites') || '')
      .split('\n').map(s => s.trim()).filter(Boolean),
  };
}

function loadSettingsIntoPanel() {
  document.getElementById('settingsKeywords').value =
    localStorage.getItem('finderKeywords') || DEFAULT_KEYWORDS;
  document.getElementById('settingsWebsites').value =
    localStorage.getItem('finderCustomWebsites') || '';
  document.getElementById('settingsUrls').value =
    localStorage.getItem('finderCustomUrls') || '';
}

function saveSearchSettings() {
  localStorage.setItem('finderKeywords',        document.getElementById('settingsKeywords').value);
  localStorage.setItem('finderCustomWebsites',  document.getElementById('settingsWebsites').value);
  localStorage.setItem('finderCustomUrls',      document.getElementById('settingsUrls').value);
  document.getElementById('searchSettingsPanel').style.display = 'none';
  document.getElementById('toggleSettingsBtn').textContent = '⚙ Settings';
  showToast('Search settings saved');
}

// ── Finder ───────────────────────────────────────────────────────────────────

function switchTab(tab) {
  document.getElementById('tabTracker').classList.toggle('active', tab === 'tracker');
  document.getElementById('tabFinder').classList.toggle('active',  tab === 'finder');
  document.getElementById('tabStats').classList.toggle('active',   tab === 'stats');
  document.getElementById('trackerPanel').style.display  = tab === 'tracker' ? '' : 'none';
  document.getElementById('trackerSearch').style.display = tab === 'tracker' ? '' : 'none';
  document.getElementById('finderPanel').style.display   = tab === 'finder'  ? '' : 'none';
  document.getElementById('statsPanel').style.display    = tab === 'stats'   ? '' : 'none';
  if (tab === 'finder') loadFinderJobs();
  if (tab === 'stats')  renderAnalytics();
}

async function loadFinderJobs() {
  const grid = document.getElementById('finderGrid');
  grid.innerHTML = `<div style="grid-column:1/-1;padding:60px 0;text-align:center;color:#94a3b8">Loading…</div>`;
  try {
    const [res, jobsRes] = await Promise.all([
      fetch(`${BACKEND}/api/jobs`),
      send('GET_JOBS')
    ]);
    if (!res.ok) throw new Error();
    finderJobs = await res.json();
    allJobs = jobsRes?.jobs || [];
    renderFinderJobs();
  } catch {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="es-icon">🔌</div>
        <div class="es-text">Server not running</div>
        <div class="es-sub">Run: <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px">cd job-finder-server && go run .</code></div>
      </div>`;
  }
}

function matchesSourceFilter(j, filter) {
  const src = j.source || '';
  switch (filter) {
    case 'linkedin': return src === 'linkedin';
    case 'google':   return src === 'google';
    case 'hn':       return src === 'hn-hiring';
    case 'indeed':   return src.startsWith('indeed-');
    case 'golang':   return src === 'golang.cafe' || src === 'golangprojects';
    case 'remote': {
      const explicit = ['linkedin','google','hn-hiring','linkedin-post','golang.cafe','golangprojects'];
      return !explicit.includes(src) && !src.startsWith('indeed-');
    }
    default: return true;
  }
}

function setFinderView(mode) {
  finderView = mode;
  document.getElementById('finderViewJobs').classList.toggle('active',  mode === 'jobs');
  document.getElementById('finderViewPosts').classList.toggle('active', mode === 'posts');
  document.getElementById('finderViewSaved').classList.toggle('active', mode === 'saved');
  document.getElementById('finderHeading').textContent =
    mode === 'posts' ? 'LinkedIn Hiring Posts — Golang Opportunities' :
    mode === 'saved' ? '⭐ Saved Jobs' :
    'Job Suggestions — Scored for Your Profile';
  // Source filter chips only make sense in the jobs view
  const filterRow = document.getElementById('finderFilterRow');
  if (filterRow) filterRow.style.display = mode === 'jobs' ? '' : 'none';
  renderFinderJobs();
}

function renderFinderJobs() {
  const grid = document.getElementById('finderGrid');

  let visibleJobs =
    finderView === 'posts' ? finderJobs.filter(j => j.source === 'linkedin-post') :
    finderView === 'saved' ? finderJobs.filter(j => savedFinderIds.has(j.id)) :
    finderJobs.filter(j => j.source !== 'linkedin-post');

  // Apply hidden filter (not in saved view — user intentionally saved those)
  if (finderView !== 'saved') {
    visibleJobs = visibleJobs.filter(j => !hiddenFinderIds.has(j.id));
  }

  // Apply source filter (jobs view only)
  if (finderView !== 'posts' && finderSourceFilter !== 'all') {
    visibleJobs = visibleJobs.filter(j => matchesSourceFilter(j, finderSourceFilter));
  }

  // Apply score minimum filter
  if (finderScoreMin > 0) {
    visibleJobs = visibleJobs.filter(j => j.score >= finderScoreMin);
  }

  // Apply text search
  if (finderSearch) {
    const q = finderSearch.toLowerCase();
    visibleJobs = visibleJobs.filter(j =>
      (j.title   || '').toLowerCase().includes(q) ||
      (j.company || '').toLowerCase().includes(q) ||
      (j.description || '').toLowerCase().includes(q)
    );
  }

  // Apply sort (default is score desc, which comes from the server)
  if (finderSort === 'date') {
    visibleJobs = [...visibleJobs].sort((a, b) =>
      new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  if (!finderJobs.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="es-icon">🔍</div>
        <div class="es-text">No jobs yet</div>
        <div class="es-sub">Click "Search New Jobs" to scrape LinkedIn &amp; Indeed</div>
      </div>`;
    return;
  }
  if (!visibleJobs.length) {
    const icon = finderView === 'posts' ? '💬' : '💼';
    const msg  = finderView === 'posts' ? 'No LinkedIn posts found yet' : 'No jobs found yet';
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="es-icon">${icon}</div>
        <div class="es-text">${msg}</div>
        <div class="es-sub">Click "Search New Jobs" to refresh</div>
      </div>`;
    return;
  }

  const normUrl = u => (u || '').split('#')[0].split('?')[0].replace(/\/$/, '').toLowerCase();
  const appliedUrls = new Set(allJobs.filter(j => j.url).map(j => normUrl(j.url)));

  grid.innerHTML = visibleJobs.map(j => {
    if (j.source === 'linkedin-post') return renderPostCard(j, normUrl, appliedUrls);
    return renderJobCard(j, normUrl, appliedUrls);
  }).join('');
}

function renderPostCard(j, normUrl, appliedUrls) {
  const sc = j.score >= 80 ? 'score-high' : j.score >= 60 ? 'score-mid' : j.score >= 40 ? 'score-low' : 'score-weak';
  const chips = (j.matchedSkills || []).map(s => `<span class="skill-chip">${s}</span>`).join('');
  const visited = visitedFinderUrls.has(j.url);
  const tracked = trackedFinderUrls.has(j.url) || appliedUrls.has(normUrl(j.url));
  const foundLabel = (() => {
    if (!j.createdAt) return '';
    const days = Math.floor((Date.now() - new Date(j.createdAt).getTime()) / 86400000);
    return days === 0 ? 'Found today' : days === 1 ? 'Found yesterday'
      : 'Found ' + new Date(j.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  })();
  const barColorPost = j.score >= 80 ? '#16a34a' : j.score >= 60 ? '#d97706' : j.score >= 40 ? '#f97316' : '#94a3b8';
  const savedPost = savedFinderIds.has(j.id);
  return `
    <div class="job-card${visited ? ' finder-visited' : ''}">
      <div class="card-header">
        <div class="card-avatar" style="background:#e0f2fe;color:#0369a1;font-size:20px">💬</div>
        <div class="card-main">
          <div class="card-title">${j.title}</div>
          <div class="card-company">${j.company || 'LinkedIn'}</div>
        </div>
        <div class="card-badges" style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <span class="score-badge ${sc}">${j.score}%</span>
          <div class="score-mini-bar-wrap"><div class="score-mini-bar" style="width:${j.score}%;background:${barColorPost}"></div></div>
          ${tracked ? '<span class="tracking-badge" style="font-size:10px;font-weight:700;color:#16a34a;background:#dcfce7;padding:2px 7px;border-radius:10px;white-space:nowrap">✓ Tracked</span>' : ''}
        </div>
      </div>
      <div class="card-body">
        <div class="card-meta">
          <div class="meta-item">🔗 LinkedIn Post</div>
          ${foundLabel ? `<div class="meta-item">🗓 ${foundLabel}</div>` : ''}
          ${j.postedAt ? `<div class="meta-item">📅 ${j.postedAt}</div>` : ''}
        </div>
        ${chips ? `<div class="skill-chips">${chips}</div>` : ''}
        ${j.description ? `<div class="card-notes" style="-webkit-line-clamp:3">${j.description}</div>` : ''}
      </div>
      <div class="card-actions">
        <button class="card-btn" data-action="view-job" data-url="${j.url}">🔗 View Post</button>
        <button class="card-btn${tracked ? ' tracked-btn' : ''}" data-finder-track="${j.id}" ${tracked ? 'disabled' : ''}>
          ${tracked ? '✓ Tracked' : '+ Track'}
        </button>
        <button class="card-btn${savedPost ? ' saved-btn' : ''}" data-finder-save="${j.id}" title="${savedPost ? 'Remove from saved' : 'Save for later'}">
          ${savedPost ? '⭐' : '☆'}
        </button>
        <button class="card-btn danger" data-finder-hide="${j.id}" title="Not interested">✕</button>
      </div>
    </div>`;
}

function renderJobCard(j, normUrl, appliedUrls) {
  const sc = j.score >= 80 ? 'score-high' : j.score >= 60 ? 'score-mid' : j.score >= 40 ? 'score-low' : 'score-weak';
    const sl = j.score >= 80 ? 'Strong Match' : j.score >= 60 ? 'Good Match' : j.score >= 40 ? 'Partial Match' : 'Weak Match';
    const src = j.source === 'linkedin'        ? '🔗 LinkedIn'
              : j.source === 'google'          ? '🔍 Google Jobs'
              : j.source === 'arbeitnow'       ? '🇪🇺 Arbeitnow'
              : j.source === 'remoteok'        ? '🌍 RemoteOK'
              : j.source === 'hn-hiring'       ? '🟠 HN Hiring'
              : j.source === 'relocate'        ? '✈️ Relocate.me'
              : j.source === 'swissdevjobs'    ? '🇨🇭 SwissDevJobs'
              : j.source === 'remotive'        ? '🌐 Remotive'
              : j.source === 'weworkremotely'  ? '💼 We Work Remotely'
              : j.source === 'jobicy'          ? '🔎 Jobicy'
              : j.source === 'themuse'         ? '🇺🇸 The Muse'
              : j.source === 'seek'            ? '🦘 Seek.com.au'
              : j.source === 'finn'            ? '🇳🇴 Finn.no'
              : j.source === 'duunitori'       ? '🇫🇮 Duunitori'
              : j.source === 'golang.cafe'     ? '🐹 golang.cafe'
              : j.source === 'golangprojects'  ? '🐹 GolangProjects'
              : j.source === 'workingnomads'   ? '🌍 Working Nomads'
              : j.source === 'wellfound'       ? '🚀 Wellfound'
              : j.source === 'devitjobs'       ? '🇪🇺 DevITjobs'
              : j.source === '4dayweek'        ? '🌴 4dayweek.io'
              : j.source === 'himalayas'       ? '🏔 Himalayas'
              : j.source === 'remote.co'       ? '🌐 Remote.co'
              : j.source === 'glassdoor'       ? '🟢 Glassdoor'
              : j.source === 'europeremotely'  ? '🇪🇺 EuropeRemotely'
              : j.source === 'jobspresso'      ? '☕ Jobspresso'
              : j.source?.startsWith('adzuna-') ? '🔍 Adzuna/' + j.source.split('-')[1]?.toUpperCase()
              : j.source?.startsWith('custom:') ? '🌐 ' + j.source.replace('custom:', '')
              : j.source?.startsWith('indeed-')  ? '📋 Indeed/' + j.source.split('-')[1]?.toUpperCase()
              : '📋 ' + j.source;
    const chips = (j.matchedSkills || []).map(s => `<span class="skill-chip">${s}</span>`).join('');
    const tracked = trackedFinderUrls.has(j.url) || appliedUrls.has(normUrl(j.url));
    const visited = visitedFinderUrls.has(j.url);
    const isNew = j.createdAt && (Date.now() - new Date(j.createdAt).getTime()) < 24 * 60 * 60 * 1000;
    const foundLabel = (() => {
      if (!j.createdAt) return '';
      const days = Math.floor((Date.now() - new Date(j.createdAt).getTime()) / 86400000);
      if (days === 0) return 'Found today';
      if (days === 1) return 'Found yesterday';
      return 'Found ' + new Date(j.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    })();
    const barColor = j.score >= 80 ? '#16a34a' : j.score >= 60 ? '#d97706' : j.score >= 40 ? '#f97316' : '#94a3b8';
    const saved = savedFinderIds.has(j.id);
    return `
      <div class="job-card${visited ? ' finder-visited' : ''}${isNew && !visited ? ' finder-new' : ''}">
        <div class="card-header">
          <div class="card-avatar">${initials(j.company)}</div>
          <div class="card-main">
            <div class="card-title">${j.title}</div>
            <div class="card-company">${j.company}${j.location ? ' · ' + j.location : ''}</div>
          </div>
          <div class="card-badges" style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            <span class="score-badge ${sc}">${j.score}%</span>
            <div class="score-mini-bar-wrap"><div class="score-mini-bar" style="width:${j.score}%;background:${barColor}"></div></div>
            ${isNew && !tracked ? '<span style="font-size:10px;font-weight:700;color:#0369a1;background:#e0f2fe;padding:2px 7px;border-radius:10px;white-space:nowrap">✨ New</span>' : ''}
            ${tracked ? '<span class="tracking-badge" style="font-size:10px;font-weight:700;color:#16a34a;background:#dcfce7;padding:2px 7px;border-radius:10px;white-space:nowrap">✓ Tracking</span>' : ''}
            ${visited && !tracked ? '<span class="visited-badge" style="font-size:10px;font-weight:700;color:#6366f1;background:#ede9fe;padding:2px 7px;border-radius:10px;white-space:nowrap">👁 Visited</span>' : ''}
          </div>
        </div>
        <div class="card-body">
          <div class="card-meta">
            <div class="meta-item">${src}</div>
            ${j.remote ? '<div class="meta-item">🏠 Remote</div>' : ''}
            ${j.salary ? `<div class="meta-item">💰 ${j.salary}</div>` : ''}
            ${foundLabel ? `<div class="meta-item">🗓 ${foundLabel}</div>` : ''}
            ${j.postedAt ? `<div class="meta-item">📅 Posted: ${j.postedAt}</div>` : ''}
          </div>
          ${chips ? `<div class="skill-chips">${chips}</div>` : ''}
          ${j.description ? `<div class="card-notes">${j.description}</div>` : ''}
        </div>
        <div class="card-actions">
          <button class="card-btn" data-action="view-job" data-url="${j.url}">🔗 View Job</button>
          <button class="card-btn${tracked ? ' tracked-btn' : ''}" data-finder-track="${j.id}" ${tracked ? 'disabled' : ''}>
            ${tracked ? '✓ Tracked' : '+ Track'}
          </button>
          <button class="card-btn${saved ? ' saved-btn' : ''}" data-finder-save="${j.id}" title="${saved ? 'Remove from saved' : 'Save for later'}">
            ${saved ? '⭐' : '☆'}
          </button>
          <button class="card-btn danger" data-finder-hide="${j.id}" title="Not interested">✕</button>
        </div>
      </div>`;
}

async function searchJobs() {
  const btn = document.getElementById('searchJobsBtn');
  const statusEl = document.getElementById('finderStatus');
  btn.disabled = true;
  btn.textContent = '🔍 Searching…';
  statusEl.style.display = '';
  statusEl.textContent = 'Scraping LinkedIn & Indeed…';
  statusEl.className = 'finder-status searching';

  try {
    const settings = loadSearchSettings();
    const res = await fetch(`${BACKEND}/api/jobs/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error('server error');
    const { status } = await res.json();
    if (status === 'already_searching') {
      statusEl.textContent = 'Already searching, please wait…';
    }
    startPollStatus(btn, statusEl);
  } catch {
    btn.disabled = false;
    btn.textContent = '🔍 Search New Jobs';
    statusEl.textContent = 'Cannot reach server. Is it running?';
    statusEl.className = 'finder-status error';
  }
}

function startPollStatus(btn, statusEl) {
  if (finderPollInterval) clearInterval(finderPollInterval);
  finderPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`${BACKEND}/api/jobs/status`);
      const { status, found, error } = await res.json();
      if (status === 'done') {
        clearInterval(finderPollInterval);
        btn.disabled = false;
        btn.textContent = '🔍 Search New Jobs';
        statusEl.textContent = `✓ Found ${found} new jobs`;
        statusEl.className = 'finder-status';
        loadFinderJobs();
      } else if (status === 'error') {
        clearInterval(finderPollInterval);
        btn.disabled = false;
        btn.textContent = '🔍 Search New Jobs';
        statusEl.textContent = `Error: ${error}`;
        statusEl.className = 'finder-status error';
      }
    } catch {}
  }, 5000);
}

// ── Analytics ─────────────────────────────────────────────────────────────────

function getWeeklyApplications(jobs, numWeeks = 8) {
  const now = new Date();
  const weeks = [];
  for (let i = numWeeks - 1; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() - i * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const count = jobs.filter(j => {
      if (!j.appliedDate) return false;
      const d = new Date(j.appliedDate);
      return d >= weekStart && d < weekEnd;
    }).length;
    weeks.push({ label, count });
  }
  return weeks;
}

function renderGoal() {
  const goal = parseInt(localStorage.getItem('weeklyGoal') || '5', 10);
  const input = document.getElementById('goalInput');
  if (input) input.value = goal;

  // Count applications this current week (Sun–Sat)
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const thisWeek = allJobs.filter(j => j.appliedDate && new Date(j.appliedDate) >= weekStart).length;

  const pct = Math.min(100, Math.round(thisWeek / goal * 100));
  const bar = document.getElementById('goalBar');
  const label = document.getElementById('goalLabel');
  if (bar)   bar.style.width = pct + '%';
  if (bar)   bar.style.background = pct >= 100 ? '#16a34a' : pct >= 60 ? '#2563eb' : '#f97316';
  if (label) label.textContent = `${thisWeek} / ${goal} this week${pct >= 100 ? ' 🎉' : ''}`;
}

function calcStreak(jobs) {
  const days = new Set(
    jobs
      .filter(j => j.appliedDate)
      .map(j => new Date(j.appliedDate).toLocaleDateString('en-CA')) // YYYY-MM-DD
  );
  let streak = 0;
  const d = new Date();
  // If nothing applied today, allow yesterday to still count as the streak start
  const todayStr = d.toLocaleDateString('en-CA');
  if (!days.has(todayStr)) d.setDate(d.getDate() - 1);
  while (true) {
    const key = d.toLocaleDateString('en-CA');
    if (!days.has(key)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function renderAnalytics() {
  renderGoal();
  const jobs = allJobs;
  const total = jobs.length;
  const responded   = jobs.filter(j => ['interview','offer','rejected'].includes(j.status)).length;
  const interviewed = jobs.filter(j => ['interview','offer'].includes(j.status)).length;
  const offered     = jobs.filter(j => j.status === 'offer').length;
  const active      = jobs.filter(j => !['rejected','archived','ghosted'].includes(j.status)).length;
  const responseRate  = total ? Math.round(responded   / total * 100) : 0;
  const interviewRate = total ? Math.round(interviewed / total * 100) : 0;
  const streak = calcStreak(jobs);

  document.getElementById('kpiRow').innerHTML = `
    <div class="kpi-card">
      <div class="kpi-value c-blue">${total}</div>
      <div class="kpi-label">Total Applied</div>
      <div class="kpi-sub">${active} active in pipeline</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value ${responseRate >= 20 ? 'c-green' : responseRate >= 8 ? 'c-yellow' : 'c-red'}">${responseRate}%</div>
      <div class="kpi-label">Response Rate</div>
      <div class="kpi-sub">${responded} of ${total} heard back</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value ${interviewRate >= 10 ? 'c-green' : 'c-yellow'}">${interviewRate}%</div>
      <div class="kpi-label">Interview Rate</div>
      <div class="kpi-sub">${interviewed} interview${interviewed !== 1 ? 's' : ''}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value c-yellow">${offered}</div>
      <div class="kpi-label">Offers</div>
      <div class="kpi-sub">${offered ? '🎉 Nice work!' : 'Keep going!'}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value" style="color:${streak >= 7 ? '#dc2626' : streak >= 3 ? '#d97706' : '#64748b'}">${streak}${streak > 0 ? ' 🔥' : ''}</div>
      <div class="kpi-label">Day Streak</div>
      <div class="kpi-sub">${streak === 0 ? 'Apply today to start!' : streak === 1 ? 'Started — keep going!' : `${streak} days in a row`}</div>
    </div>
  `;

  // Weekly bar chart
  const weeks = getWeeklyApplications(jobs);
  const maxCount = Math.max(...weeks.map(w => w.count), 1);
  document.getElementById('weeklyChart').innerHTML = weeks.map(w => `
    <div class="bar-col">
      <div class="bar-count">${w.count > 0 ? w.count : ''}</div>
      <div class="bar-fill" style="height:${Math.round(w.count / maxCount * 90)}px"></div>
      <div class="bar-label">${w.label}</div>
    </div>
  `).join('');

  // Status breakdown
  const statusDefs = [
    { key: 'applied',   label: 'Applied',   color: '#2563eb' },
    { key: 'interview', label: 'Interview',  color: '#16a34a' },
    { key: 'offer',     label: 'Offer',      color: '#d97706' },
    { key: 'rejected',  label: 'Rejected',   color: '#dc2626' },
    { key: 'ghosted',   label: 'Ghosted',    color: '#94a3b8' },
  ];
  const maxStatus = Math.max(...statusDefs.map(s => jobs.filter(j => j.status === s.key).length), 1);
  document.getElementById('statusChart').innerHTML = statusDefs.map(s => {
    const count = jobs.filter(j => j.status === s.key).length;
    return `
      <div class="hbar-row">
        <div class="hbar-label">${s.label}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(count/maxStatus*100)}%;background:${s.color}"></div></div>
        <div class="hbar-count">${count}</div>
      </div>`;
  }).join('');

  // Method breakdown
  const methodDefs = [
    { key: 'online',   label: '🌐 Online'   },
    { key: 'linkedin', label: '🔗 LinkedIn'  },
    { key: 'email',    label: '📧 Email'     },
    { key: 'referral', label: '🤝 Referral'  },
  ];
  const methodCounts = {};
  for (const j of jobs) {
    const m = j.applicationMethod || 'online';
    methodCounts[m] = (methodCounts[m] || 0) + 1;
  }
  const maxMethod = Math.max(...Object.values(methodCounts), 1);
  document.getElementById('methodChart').innerHTML = methodDefs
    .filter(m => methodCounts[m.key])
    .sort((a, b) => (methodCounts[b.key] || 0) - (methodCounts[a.key] || 0))
    .map(m => {
      const count = methodCounts[m.key] || 0;
      return `
        <div class="hbar-row">
          <div class="hbar-label">${m.label}</div>
          <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(count/maxMethod*100)}%;background:#6366f1"></div></div>
          <div class="hbar-count">${count}</div>
        </div>`;
    }).join('') || '<div style="font-size:12px;color:#94a3b8">No data yet</div>';
}
