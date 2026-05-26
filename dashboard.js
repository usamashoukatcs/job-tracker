let allJobs = [];
let settings = {};
let currentFilter = 'all';
let currentSearch = '';
let followupJobId = null;

const STATUS_BADGE = {
  applied: 'badge-applied', interview: 'badge-interview', rejected: 'badge-rejected',
  offer: 'badge-offer', ghosted: 'badge-ghosted', archived: 'badge-archived'
};

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
  if (!title || !company) { alert('Title and company are required.'); return; }

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
    .then(() => alert('Copied to clipboard!'));
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
  renderJobs();
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

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
    renderJobs();
  });

  // Auto-open add modal if ?add=1
  if (location.search.includes('add=1')) openAddModal();

  reload();
});
