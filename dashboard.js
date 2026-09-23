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
const selectedIds = new Set();

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

function launchConfetti() {
  const colors = ['#2563eb','#16a34a','#d97706','#dc2626','#6366f1','#ec4899','#f59e0b'];
  for (let i = 0; i < 80; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.cssText = [
      `left:${Math.random() * 100}vw`,
      `background:${colors[Math.floor(Math.random() * colors.length)]}`,
      `width:${6 + Math.random() * 8}px`,
      `height:${6 + Math.random() * 8}px`,
      `animation-duration:${1.2 + Math.random() * 2}s`,
      `animation-delay:${Math.random() * 0.6}s`,
      `border-radius:${Math.random() > 0.5 ? '50%' : '2px'}`,
    ].join(';');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
}

function showToast(msg, type = 'info', { label, onClick } = {}) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${msg}</span>`;
  if (label && onClick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = 'margin-left:10px;background:rgba(255,255,255,0.25);border:none;color:inherit;font-weight:700;cursor:pointer;padding:2px 8px;border-radius:4px;font-size:12px';
    btn.addEventListener('click', () => { onClick(); el.remove(); });
    el.appendChild(btn);
  }
  container.appendChild(el);
  const tid = setTimeout(() => el.remove(), 4000);
  if (label && onClick) el.addEventListener('click', () => clearTimeout(tid), { once: true });
}

function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  const count = document.getElementById('bulkCount');
  if (selectedIds.size > 0) {
    bar.style.display = 'flex';
    count.textContent = `${selectedIds.size} selected`;
  } else {
    bar.style.display = 'none';
  }
}

function clearSelection() {
  selectedIds.clear();
  document.querySelectorAll('.job-card.selected').forEach(c => c.classList.remove('selected'));
  updateBulkBar();
}

function toggleSelect(id, cardEl) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    cardEl.classList.remove('selected');
  } else {
    selectedIds.add(id);
    cardEl.classList.add('selected');
  }
  updateBulkBar();
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

const AVATAR_PALETTE = [
  { bg: '#dbeafe', fg: '#1d4ed8' }, // blue
  { bg: '#dcfce7', fg: '#15803d' }, // green
  { bg: '#fce7f3', fg: '#9d174d' }, // pink
  { bg: '#fed7aa', fg: '#c2410c' }, // orange
  { bg: '#e9d5ff', fg: '#6d28d9' }, // purple
  { bg: '#fef3c7', fg: '#b45309' }, // yellow
  { bg: '#cffafe', fg: '#0e7490' }, // cyan
  { bg: '#d1fae5', fg: '#065f46' }, // teal
];
function avatarStyle(company) {
  const hash = (company || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const { bg, fg } = AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  return `background:${bg};color:${fg}`;
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
    case 'priority':  jobs.sort((a, b) => (b.priority || 0) - (a.priority || 0)); break;
    default:          jobs.sort((a, b) => new Date(b.appliedDate) - new Date(a.appliedDate)); break;
  }
  return jobs;
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderStats() {
  document.getElementById('sAll').textContent       = allJobs.length;
  document.getElementById('sApplied').textContent   = allJobs.filter(j => j.status === 'applied').length;
  document.getElementById('sInterview').textContent = allJobs.filter(j => j.status === 'interview').length;
  document.getElementById('sOffer').textContent     = allJobs.filter(j => j.status === 'offer').length;
  document.getElementById('sRejected').textContent  = allJobs.filter(j => j.status === 'rejected').length;
  document.getElementById('sGhosted').textContent   = allJobs.filter(j => j.status === 'ghosted').length;

  const todayStr = new Date().toLocaleDateString('en-CA');
  const todayCount = allJobs.filter(j =>
    j.appliedDate && new Date(j.appliedDate).toLocaleDateString('en-CA') === todayStr
  ).length;
  const todayEl = document.getElementById('sToday');
  if (todayEl) todayEl.textContent = todayCount;
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
      <div class="job-card" id="card-${j.id}" data-job-id="${j.id}" data-status="${j.status}">
        <label style="position:absolute;top:10px;right:10px;cursor:pointer;display:none" class="bulk-check">
          <input type="checkbox" data-select-id="${j.id}" style="width:15px;height:15px;cursor:pointer" ${selectedIds.has(j.id) ? 'checked' : ''}>
        </label>
        <div class="card-header">
          <div class="card-avatar" style="${avatarStyle(j.company)}">${initials(j.company)}</div>
          <div class="card-main">
            <div class="card-title">${j.title}</div>
            <div class="card-company">${j.company}</div>
            <div class="priority-stars" data-job-id="${j.id}">${[1,2,3].map(n => `<span class="pstar${(j.priority||0) >= n ? ' pstar-on' : ''}" data-star="${n}" title="${n === 1 ? 'Low' : n === 2 ? 'Medium' : 'High'} priority">★</span>`).join('')}</div>
          </div>
          <div class="card-badge">
            <span class="badge ${STATUS_BADGE[j.status] || 'badge-applied'}">${j.status}</span>
            ${j.statusUpdated ? `<span style="font-size:10px;color:#94a3b8;display:block;text-align:right;margin-top:3px">${daysSince(j.statusUpdated)}d</span>` : ''}</div>
        </div>

        <div class="card-body">
          <div class="card-meta">
            <div class="meta-item">📅 ${fmtDate(j.appliedDate)}</div>
            <div class="meta-item">${methodIcon}</div>
            ${j.salary ? `<div class="meta-item">💰 ${j.salary}</div>` : ''}
            ${j.url ? `<div class="meta-item"><a href="${j.url}" target="_blank" style="color:#2563eb;text-decoration:none">🔗 View Job</a></div>` : ''}
          </div>
          ${(function() {
            if (!j.interviewDate) return '';
            const diff = Math.round((new Date(j.interviewDate) - Date.now()) / 86400000);
            if (diff < -1) return '';
            const label = diff < 0 ? 'was yesterday' : diff === 0 ? 'is today!' : diff === 1 ? 'is tomorrow' : `in ${diff} days`;
            const bg = diff <= 1 ? '#dcfce7' : '#dbeafe';
            const col = diff <= 1 ? '#15803d' : '#1d4ed8';
            return `<div style="background:${bg};border:1px solid;border-color:${bg};border-radius:6px;padding:7px 10px;font-size:12px;color:${col};font-weight:600;margin-bottom:10px">📅 Interview ${label}</div>`;
          })()}
          ${followupDue ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:7px 10px;font-size:12px;color:#92400e;margin-bottom:10px">⏰ Follow-up overdue — ${daysAgo} days with no response</div>` : ''}
          ${j.notes ? `<div class="card-notes">${j.notes}</div>` : ''}
          ${events.length > 0 ? `<div class="timeline"><div class="timeline-title">History</div>${timeline}</div>` : ''}
          <div class="quick-note-row">
            <input class="quick-note-input" data-job-id="${j.id}" placeholder="+ Quick note…" type="text" maxlength="200">
            <button class="quick-note-submit" data-job-id="${j.id}" title="Save note">✓</button>
          </div>
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
          <button class="card-btn" data-action="copy" data-job-id="${j.id}" title="Copy job details">📋</button>
          <button class="card-btn danger" data-action="delete" data-job-id="${j.id}">🗑</button>
        </div>
      </div>`;
  }).join('');
}

// ── Job actions ──────────────────────────────────────────────────────────────

async function quickStatus(id, status) {
  await send('UPDATE_JOB', { id, updates: { status, statusUpdated: new Date().toISOString() } });
  if (status === 'offer') {
    launchConfetti();
    showToast('🎉 Congratulations on the offer!', 'success');
  }
  await reload();
}

async function submitQuickNote(jobId, input) {
  if (!input) return;
  const note = input.value.trim();
  if (!note) return;
  await send('UPDATE_JOB', { id: jobId, updates: { _note: note, status: allJobs.find(j => j.id === jobId)?.status } });
  input.value = '';
  showToast('Note saved', 'success');
  await reload();
}

function deleteJob(id) {
  const job = allJobs.find(j => j.id === id);
  if (!job) return;
  // Optimistically hide the card
  const card = document.getElementById(`card-${id}`);
  if (card) card.style.display = 'none';
  let undone = false;
  const tid = setTimeout(async () => {
    if (!undone) { await send('DELETE_JOB', { id }); await reload(); }
  }, 4500);
  showToast(`Deleted "${job.title} at ${job.company}"`, 'info', {
    label: 'Undo',
    onClick: () => {
      undone = true;
      clearTimeout(tid);
      if (card) card.style.display = '';
    }
  });
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
  document.getElementById('fInterviewDate').value = '';
  document.getElementById('fSalary').value      = '';
  document.getElementById('fEmail').value       = '';
  document.getElementById('fNotes').value       = '';
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
  document.getElementById('fInterviewDate').value = j.interviewDate ? j.interviewDate.split('T')[0] : '';
  document.getElementById('fSalary').value      = j.salary || '';
  document.getElementById('fEmail').value       = j.contactEmail || '';
  document.getElementById('fNotes').value       = j.notes || '';
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
    interviewDate: document.getElementById('fInterviewDate').value
      ? new Date(document.getElementById('fInterviewDate').value).toISOString()
      : null,
    salary:       document.getElementById('fSalary').value.trim(),
    contactEmail: document.getElementById('fEmail').value.trim(),
    notes:        document.getElementById('fNotes').value.trim()
  };

  if (id) {
    const existing = allJobs.find(j => j.id === id);
    if (existing && existing.status !== data.status) data.statusUpdated = new Date().toISOString();
    await send('UPDATE_JOB', { id, updates: data });
  } else {
    const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const dupe = allJobs.find(j =>
      norm(j.company) === norm(data.company) && norm(j.title) === norm(data.title)
    );
    if (dupe) {
      const go = confirm(`You already have "${dupe.title} at ${dupe.company}" (${dupe.status}). Add anyway?`);
      if (!go) return;
    }
    data.statusUpdated = new Date().toISOString();
    await send('ADD_JOB', { job: data });
  }

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

  // Bulk selection via checkbox
  document.getElementById('jobsGrid').addEventListener('change', e => {
    const cb = e.target.closest('[data-select-id]');
    if (!cb) return;
    toggleSelect(cb.dataset.selectId, cb.closest('.job-card'));
  });

  // Bulk action buttons
  document.getElementById('bulkArchiveBtn').addEventListener('click', async () => {
    const ids = [...selectedIds];
    for (const id of ids) await send('UPDATE_JOB', { id, updates: { status: 'archived' } });
    clearSelection();
    showToast(`Archived ${ids.length} job${ids.length !== 1 ? 's' : ''}`, 'info');
    await reload();
  });
  document.getElementById('bulkDeleteBtn').addEventListener('click', async () => {
    const ids = [...selectedIds];
    if (!confirm(`Delete ${ids.length} job${ids.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    for (const id of ids) await send('DELETE_JOB', { id });
    clearSelection();
    showToast(`Deleted ${ids.length} job${ids.length !== 1 ? 's' : ''}`, 'info');
    await reload();
  });
  document.getElementById('bulkCancelBtn').addEventListener('click', clearSelection);
  document.getElementById('bulkStatusSelect').addEventListener('change', async e => {
    const status = e.target.value;
    if (!status) return;
    e.target.value = '';
    const ids = [...selectedIds];
    for (const id of ids) await send('UPDATE_JOB', { id, updates: { status, statusUpdated: new Date().toISOString() } });
    clearSelection();
    showToast(`Marked ${ids.length} job${ids.length !== 1 ? 's' : ''} as "${status}"`, 'info');
    await reload();
  });

  // Priority stars
  document.getElementById('jobsGrid').addEventListener('click', async e => {
    const star = e.target.closest('.pstar');
    if (!star) return;
    const wrap  = star.closest('.priority-stars');
    const jobId = wrap?.dataset.jobId;
    if (!jobId) return;
    const n = parseInt(star.dataset.star, 10);
    const job = allJobs.find(j => j.id === jobId);
    const newPriority = job && job.priority === n ? 0 : n; // click same star to clear
    await send('UPDATE_JOB', { id: jobId, updates: { priority: newPriority } });
    await reload();
  });

  // Quick inline note: submit on ✓ click
  document.getElementById('jobsGrid').addEventListener('click', async e => {
    const btn = e.target.closest('.quick-note-submit');
    if (!btn) return;
    const jobId = btn.dataset.jobId;
    const input = document.querySelector(`.quick-note-input[data-job-id="${jobId}"]`);
    await submitQuickNote(jobId, input);
  });

  // Quick inline note: submit on Enter
  document.getElementById('jobsGrid').addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    const input = e.target.closest('.quick-note-input');
    if (!input) return;
    e.preventDefault();
    await submitQuickNote(input.dataset.jobId, input);
  });

  // Job grid: click delegation (edit, delete, followup)
  document.getElementById('jobsGrid').addEventListener('click', e => {
    if (e.target.closest('.pstar')) return; // handled above
    if (e.target.closest('.quick-note-submit')) return; // handled above
    const btn   = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const jobId  = btn.dataset.jobId || btn.closest('[data-job-id]')?.dataset.jobId;
    if (action === 'edit')     editJob(jobId);
    if (action === 'delete')   deleteJob(jobId);
    if (action === 'followup') openFollowupModal(jobId);
    if (action === 'copy') {
      const job = allJobs.find(j => j.id === jobId);
      if (job) {
        const text = [job.title, job.company, job.url].filter(Boolean).join(' | ');
        navigator.clipboard.writeText(text).then(() => showToast('Job details copied!', 'success'));
      }
    }
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
    // Quick Apply — open URL + pre-fill add modal
    const applyBtn = e.target.closest('[data-finder-apply]');
    if (applyBtn) {
      const job = finderJobs.find(j => j.id === applyBtn.dataset.id);
      if (!job) return;
      window.open(job.url, '_blank');
      switchTab('tracker');
      openAddModal({ title: job.title, company: job.company, url: job.url });
      return;
    }

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
  if (tab !== 'tracker') clearSelection();
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
          <div class="card-avatar" style="${avatarStyle(j.company)}">${initials(j.company)}</div>
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
          <button class="card-btn" data-action="view-job" data-url="${j.url}">🔗 View</button>
          ${!tracked ? `<button class="card-btn" style="background:#eff6ff;border-color:#93c5fd;color:#1d4ed8;font-weight:700" data-finder-apply data-id="${j.id}">✚ Apply</button>` : ''}
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

  const earliest = jobs.reduce((min, j) => {
    if (!j.appliedDate) return min;
    const d = new Date(j.appliedDate);
    return (!min || d < min) ? d : min;
  }, null);
  const activeDays = earliest ? Math.floor((Date.now() - earliest.getTime()) / 86400000) : 0;

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
    <div class="kpi-card">
      <div class="kpi-value c-gray">${activeDays}</div>
      <div class="kpi-label">Days Searching</div>
      <div class="kpi-sub">${earliest ? `Since ${earliest.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})}` : 'No applications yet'}</div>
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

  // Application heatmap (last 16 weeks)
  const WEEKS = 16;
  const DAYS  = WEEKS * 7;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const startDay = new Date(today); startDay.setDate(today.getDate() - DAYS + 1);

  const countByDate = {};
  for (const j of jobs) {
    if (!j.appliedDate) continue;
    const d = new Date(j.appliedDate); d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    countByDate[key] = (countByDate[key] || 0) + 1;
  }

  const DAY_LABELS = ['', 'M', '', 'W', '', 'F', ''];
  const cols = [];
  let monthLabels = [];
  let lastMonth = -1;

  for (let w = 0; w < WEEKS; w++) {
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(startDay); date.setDate(startDay.getDate() + w * 7 + d);
      const key  = date.toISOString().slice(0, 10);
      const cnt  = Math.min(countByDate[key] || 0, 4);
      const title = `${key}: ${countByDate[key] || 0} application${countByDate[key] !== 1 ? 's' : ''}`;
      cells.push(`<div class="heatmap-cell" data-count="${cnt}" title="${title}"></div>`);
      if (d === 0 && date.getMonth() !== lastMonth) {
        lastMonth = date.getMonth();
        monthLabels.push({ w, label: date.toLocaleDateString('en-US', { month: 'short' }) });
      }
    }
    cols.push(`<div class="heatmap-col">${cells.join('')}</div>`);
  }

  const dayAxis = `<div class="heatmap-col" style="margin-right:2px">${DAY_LABELS.map(l => `<div class="heatmap-day-label">${l}</div>`).join('')}</div>`;
  const monthRow = `<div class="heatmap-month-labels">${
    monthLabels.map(m => `<div class="heatmap-month-label" style="min-width:${m.w === 0 ? 0 : (m.w - (monthLabels[monthLabels.indexOf(m) - 1]?.w ?? 0)) * 14}px">${m.label}</div>`).join('')
  }</div>`;

  document.getElementById('heatmapChart').innerHTML =
    `${monthRow}<div class="heatmap-wrap">${dayAxis}${cols.join('')}</div>`;
}
