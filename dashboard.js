// Apply saved dark mode before any rendering to avoid flash
(function () {
  const saved = localStorage.getItem('darkMode');
  if (saved) document.body.setAttribute('data-theme', saved);
})();

let allJobs = [];
let settings = {};
let currentFilter = 'all';
let currentSearch = '';
let currentTagFilters = new Set();
let currentColorFilter = null;
let currentWorkTypeFilter = '';
let followupJobId = null;
let followupMode  = 'followup';
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
const finderNotes = JSON.parse(localStorage.getItem('finderNotes') || '{}');
let globalSearchWishlist = [];

const DEFAULT_KEYWORDS = [
  'backend engineer',
  'software engineer',
  'backend developer',
  'platform engineer',
].join('\n');

const ACCENT_COLORS = [
  { name: 'Blue',   hex: '#2563eb' },
  { name: 'Green',  hex: '#16a34a' },
  { name: 'Purple', hex: '#7c3aed' },
  { name: 'Pink',   hex: '#db2777' },
  { name: 'Orange', hex: '#ea580c' },
  { name: 'Teal',   hex: '#0891b2' },
];

const LABEL_COLORS = [null, '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7'];
const LABEL_NAMES  = ['None', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple'];

const REASON_OPTIONS = {
  rejected: ['Not selected', 'Overqualified', 'Under-qualified', 'Salary mismatch', 'Role cancelled', 'Better candidate chosen'],
  ghosted:  ['No response after apply', 'No response after interview', 'Recruiter went silent', 'Company stopped responding'],
};

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

function applyAccentColor(hex) {
  const h = hex || '#2563eb';
  const el = document.getElementById('accentOverride');
  if (!el) return;
  el.textContent = h === '#2563eb' ? '' : `
    .filter-tab.active,.view-btn.active,.finder-chip.active { background:${h} !important;border-color:${h} !important; }
    .main-tab.active { color:${h} !important;border-bottom-color:${h} !important; }
    .main-tab:hover { color:${h} !important; }
    .btn-primary { background:${h} !important; }
    .tb-btn.accent { color:${h} !important; }
    .quick-note-submit { background:${h} !important; }
    .job-card[data-status="applied"] { border-left-color:${h} !important; }
    .c-blue { color:${h} !important; }
    .bar-fill { background:${h} !important; }
    .topbar { background:linear-gradient(135deg,${h}bb 0%,${h} 60%,${h}ee 100%) !important; }
    .reason-chip:hover,.reason-chip.selected { background:${h} !important;border-color:${h} !important; }
  `;
  document.querySelectorAll('.theme-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.hex === h);
    sw.style.color = sw.dataset.hex;
  });
  localStorage.setItem('accentColor', h);
}

function parseCsvLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { result.push(cur); cur = ''; }
    else cur += c;
  }
  result.push(cur);
  return result;
}

function parseCsvToJobs(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const col = k => headers.indexOf(k);
  return lines.slice(1).map(line => {
    const vals = parseCsvLine(line);
    const get  = k => (vals[col(k)] || '').trim();
    const title   = get('title');
    const company = get('company');
    if (!title || !company) return null;
    const rawDate = get('applied date') || get('applieddate') || get('date');
    const appliedDate = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString();
    return {
      title, company,
      status:            get('status') || 'applied',
      applicationMethod: get('method') || 'online',
      url:               get('url') || '',
      notes:             get('notes') || '',
      appliedDate,
      statusUpdated:     new Date().toISOString(),
      events: [{ date: appliedDate, type: 'applied', note: 'Imported' }],
    };
  }).filter(Boolean);
}

function exportCsv(jobsToExport) {
  const jobs = jobsToExport || allJobs;
  if (!jobs.length) { showToast('No jobs to export.', 'error'); return; }
  const headers = ['Title', 'Company', 'Status', 'Applied Date', 'Method', 'URL', 'Location', 'Work Type', 'Salary', 'Resume Version', 'Recruiter', 'Recruiter LinkedIn', 'Tags', 'Notes', 'Prep Notes', 'Cover Letter'];
  const rows = jobs.map(j => [
    j.title || '',
    j.company || '',
    j.status || '',
    j.appliedDate ? new Date(j.appliedDate).toLocaleDateString('en-US') : '',
    j.applicationMethod || '',
    j.url || '',
    j.location || '',
    j.workType || '',
    j.salary || '',
    j.resumeVersion || '',
    j.recruiterName || '',
    j.recruiterLinkedin || '',
    (j.tags || []).join('; '),
    (j.notes || '').replace(/\r?\n/g, ' '),
    (j.prepNotes || '').replace(/\r?\n/g, ' '),
    (j.coverLetter || '').replace(/\r?\n/g, ' '),
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  const label = jobsToExport ? currentFilter : 'all';
  a.download = `jobs-${label}-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportJson() {
  const res = await send('GET_COMPANY_NOTES');
  const companyNotes = res?.notes || {};
  const json = JSON.stringify(Object.keys(companyNotes).length ? { jobs: allJobs, companyNotes } : allJobs, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `jobs-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Backup saved — ${allJobs.length} job${allJobs.length !== 1 ? 's' : ''}`, 'success');
}

async function restoreJson(file) {
  const text = await file.text();
  let jobs, companyNotes = null;
  try { jobs = JSON.parse(text); } catch { showToast('Invalid JSON file.', 'error'); return; }
  if (jobs && !Array.isArray(jobs) && Array.isArray(jobs.jobs)) {
    companyNotes = jobs.companyNotes || null;
    jobs = jobs.jobs;
  }
  if (!Array.isArray(jobs) || !jobs.length) { showToast('File contains no jobs.', 'error'); return; }
  const replace = confirm(
    `Found ${jobs.length} job${jobs.length !== 1 ? 's' : ''} in backup.\n\n` +
    `OK = Replace ALL existing jobs with backup\n` +
    `Cancel = Merge (add backup jobs without deleting existing ones)`
  );
  if (replace) {
    await send('REPLACE_ALL_JOBS', { jobs });
  } else {
    for (const job of jobs) await send('ADD_JOB', { job: { ...job, id: Date.now().toString() + Math.random().toString(36).slice(2) } });
  }
  if (companyNotes) {
    const existing = (await send('GET_COMPANY_NOTES'))?.notes || {};
    for (const [key, note] of Object.entries(companyNotes)) {
      if (replace || !existing[key]) await send('SAVE_COMPANY_NOTE', { key, text: note.text });
    }
  }
  await reload();
  showToast(`Restored ${jobs.length} job${jobs.length !== 1 ? 's' : ''}`, 'success');
}

function icsEscape(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsDate(iso) {
  return iso.slice(0, 10).replace(/-/g, '');
}

function jobCalendarEvents(j) {
  const events = [];
  const desc = [j.url, j.recruiterName ? `Recruiter: ${j.recruiterName}` : '', j.contactEmail || ''].filter(Boolean).join('\n');
  if (j.interviewDate) events.push({ kind: 'interview', date: j.interviewDate, summary: `Interview: ${j.title} @ ${j.company}` });
  if (j.deadline)      events.push({ kind: 'deadline',  date: j.deadline,      summary: `Apply by: ${j.title} @ ${j.company}` });
  if (j.followupDate)  events.push({ kind: 'followup',  date: j.followupDate,  summary: `Follow up: ${j.title} @ ${j.company}` });
  return events.map(e => ({ ...e, uid: `${j.id}-${e.kind}@jobtracker`, description: desc }));
}

function downloadIcs(events, filename) {
  if (!events.length) { showToast('No dates to export.', 'error'); return; }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JobTracker//EN', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    const start = icsDate(e.date);
    const end   = new Date(Date.UTC(+start.slice(0, 4), +start.slice(4, 6) - 1, +start.slice(6, 8) + 1)).toISOString().slice(0, 10).replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${icsEscape(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${icsEscape(e.description)}`] : []),
      'BEGIN:VALARM', 'TRIGGER:-PT12H', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(e.summary)}`, 'END:VALARM',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${events.length} event${events.length !== 1 ? 's' : ''} to calendar file`, 'success');
}

function exportAllCalendar() {
  const today = new Date().toISOString().slice(0, 10);
  const events = allJobs
    .filter(j => !['archived', 'rejected'].includes(j.status))
    .flatMap(jobCalendarEvents)
    .filter(e => e.date.slice(0, 10) >= today);
  downloadIcs(events, `job-dates-${today}.ics`);
}

function companyKey(name) {
  return (name || '').toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|gmbh|ag|bv|sa|srl|corp|corporation|co|plc)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function groupByCompany(jobs) {
  const map = new Map();
  for (const j of jobs) {
    const k = companyKey(j.company);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(j);
  }
  return map;
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
  currentTagFilters.clear();
  currentColorFilter = null;
  currentWorkTypeFilter = '';
  const wtSel = document.getElementById('workTypeFilter');
  if (wtSel) wtSel.value = '';
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.stat-card').forEach(t => t.classList.remove('active'));
  if (clickedEl) clickedEl.classList.add('active');
  renderJobs();
}

function loadSavedViews() {
  try { return JSON.parse(localStorage.getItem('savedViews') || '[]'); } catch { return []; }
}

function storeSavedViews(views) {
  try { localStorage.setItem('savedViews', JSON.stringify(views)); } catch {}
}

function currentViewState() {
  return {
    filter:   currentFilter,
    tags:     [...currentTagFilters].sort(),
    color:    currentColorFilter,
    workType: currentWorkTypeFilter,
    search:   currentSearch,
    sort:     trackerSort
  };
}

function sameViewState(a, b) {
  return a.filter === b.filter && a.color === b.color && a.workType === b.workType &&
    a.search === b.search && a.sort === b.sort && a.tags.join('|') === b.tags.join('|');
}

function renderSavedViews() {
  const bar = document.getElementById('savedViewsBar');
  if (!bar) return;
  const views = loadSavedViews();
  const now   = currentViewState();
  bar.innerHTML = views.map((v, i) => `
    <span class="saved-view-chip${sameViewState(v.state, now) ? ' active' : ''}" data-view-idx="${i}" title="Apply saved view">
      ${escHtml(v.name)}<span class="sv-remove" data-remove-view="${i}" title="Delete view">✕</span>
    </span>`).join('') +
    `<button class="saved-view-add" id="saveViewBtn" title="Save the current filters, tags, search and sort as a view">＋ Save view</button>`;
}

function saveCurrentView() {
  const name = (prompt('Name this view:') || '').trim();
  if (!name) return;
  const views = loadSavedViews().filter(v => v.name.toLowerCase() !== name.toLowerCase());
  views.push({ name: name.slice(0, 40), state: currentViewState() });
  storeSavedViews(views);
  renderSavedViews();
  showToast(`Saved view "${name}"`, 'success');
}

function applySavedView(idx) {
  const view = loadSavedViews()[idx];
  if (!view) return;
  const s = view.state;
  setFilter(s.filter, document.querySelector(`.filter-tab[data-filter="${s.filter}"]`));
  currentTagFilters     = new Set(s.tags || []);
  currentColorFilter    = s.color ?? null;
  currentWorkTypeFilter = s.workType || '';
  currentSearch         = s.search || '';
  trackerSort           = s.sort || 'date-desc';
  document.getElementById('workTypeFilter').value = currentWorkTypeFilter;
  document.getElementById('searchInput').value    = currentSearch;
  document.getElementById('trackerSort').value    = trackerSort;
  if (viewMode === 'kanban') renderKanban(); else renderJobs();
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function collectContacts(jobs) {
  const byKey = new Map();
  for (const j of jobs) {
    const name  = (j.recruiterName || '').trim();
    const email = (j.contactEmail || '').trim().toLowerCase();
    const li    = (j.recruiterLinkedin || '').trim();
    if (!name && !email && !li) continue;
    const key = email || li.toLowerCase().replace(/\/+$/, '') || `${name.toLowerCase()}|${companyKey(j.company)}`;
    if (!byKey.has(key)) byKey.set(key, { name: '', email: '', linkedin: '', jobs: [], lastActivity: null });
    const c = byKey.get(key);
    c.name     = c.name || name;
    c.email    = c.email || email;
    c.linkedin = c.linkedin || li;
    c.jobs.push(j);
    const last = lastActivityOf(j);
    if (!c.lastActivity || new Date(last) > new Date(c.lastActivity)) c.lastActivity = last;
  }
  return [...byKey.values()].sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
}

function filteredContacts() {
  const q = (document.getElementById('contactsSearch')?.value || '').trim().toLowerCase();
  const all = collectContacts(allJobs);
  if (!q) return all;
  return all.filter(c => [c.name, c.email, c.linkedin, ...c.jobs.map(j => `${j.company} ${j.title}`)].join(' ').toLowerCase().includes(q));
}

function renderContacts() {
  const list = document.getElementById('contactsList');
  const contacts = filteredContacts();
  if (!contacts.length) {
    list.innerHTML = `<div class="empty-state"><div class="es-icon">👥</div><div class="es-text">No contacts yet</div><div class="es-sub">Add a recruiter name, LinkedIn or contact email to a job and it shows up here</div></div>`;
    return;
  }
  list.innerHTML = contacts.map(c => {
    const companies = [...new Set(c.jobs.map(j => j.company))];
    const title = c.name || c.email || 'LinkedIn contact';
    return `
      <div class="contact-row">
        <div class="card-avatar" style="${avatarStyle(title)}">${escHtml(initials(title))}</div>
        <div class="contact-main">
          <div class="contact-name">${escHtml(title)}</div>
          <div class="contact-sub">${escHtml(companies.join(' · '))} — last activity ${daysSince(c.lastActivity)}d ago</div>
          <div class="contact-jobs">${c.jobs.map(j => `<span class="contact-job" data-contact-company="${escHtml(j.company)}" title="Show in tracker">${escHtml(j.title)} · ${escHtml(j.status)}</span>`).join('')}</div>
        </div>
        <div class="contact-actions">
          ${c.email ? `<a class="card-btn" href="mailto:${escHtml(c.email)}" title="${escHtml(c.email)}" style="text-decoration:none">✉</a>` : ''}
          ${c.email ? `<button class="card-btn" data-copy-email="${escHtml(c.email)}" title="Copy email">📋</button>` : ''}
          ${/^https?:\/\//i.test(c.linkedin) ? `<a class="card-btn" href="${escHtml(c.linkedin)}" target="_blank" title="LinkedIn profile" style="text-decoration:none">🔗</a>` : ''}
        </div>
      </div>`;
  }).join('');
}

function monthlySalary(s) {
  if (!s) return null;
  const text = s.toLowerCase();
  const hourly = /(\/|per |an? )\s*(hr|hour)|hourly/.test(text);
  const nums = [...text.replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2').replace(/[,\s]/g, '').matchAll(/(\d+(?:\.\d+)?)(k?)/g)]
    .map(m => parseFloat(m[1]) * (m[2] === 'k' ? 1000 : 1))
    .filter(n => n >= (hourly ? 1 : 100));
  if (!nums.length) return null;
  const top = Math.max(...nums.slice(0, 2));
  if (hourly) return top * 160;
  if (/(\/|per |a )\s*(mo|month)|monthly|p\.?m\b/.test(text)) return top;
  if (/(\/|per |a )\s*(yr|year|annum)|yearly|annual|p\.?a\b/.test(text)) return top / 12;
  return top >= 15000 ? top / 12 : top;
}

function belowSalaryFloor(j) {
  const floor = settings.minMonthlySalary;
  if (!floor) return null;
  const monthly = monthlySalary(j.salary);
  if (monthly === null || monthly >= floor) return null;
  return Math.round(monthly);
}

function salaryMeta(j) {
  const low = belowSalaryFloor(j);
  return low === null
    ? `<div class="meta-item">💰 ${j.salary}</div>`
    : `<div class="meta-item" style="color:#dc2626;font-weight:600" title="≈ ${low.toLocaleString()}/month — below your floor of ${settings.minMonthlySalary.toLocaleString()}/month">⚠ 💰 ${j.salary}</div>`;
}

function skillMatch(jobDescription, skills) {
  if (!jobDescription || !skills || !skills.length) return null;
  const matched = [], missing = [];
  for (const skill of skills) {
    const esc = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re  = new RegExp(`(^|[^A-Za-z0-9+#])${esc}(?![A-Za-z0-9+#])`, skill.length <= 3 ? '' : 'i');
    (re.test(jobDescription) ? matched : missing).push(skill);
  }
  return { matched, missing, pct: Math.round(matched.length / skills.length * 100) };
}

// Common skills to look for in saved job descriptions, on top of settings.mySkills.
const SKILL_VOCAB = [
  'Go', 'Golang', 'Python', 'Java', 'Kotlin', 'Rust', 'C++', 'C#', 'Ruby', 'PHP', 'Scala', 'Elixir',
  'JavaScript', 'TypeScript', 'Node.js', 'React', 'Vue', 'Angular', 'Svelte',
  'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch', 'Cassandra', 'DynamoDB', 'ClickHouse',
  'Kafka', 'RabbitMQ', 'NATS', 'gRPC', 'GraphQL', 'REST', 'Protobuf', 'WebSockets',
  'Docker', 'Kubernetes', 'Helm', 'Terraform', 'Ansible', 'Linux', 'Bash',
  'AWS', 'GCP', 'Azure', 'Lambda', 'S3',
  'CI/CD', 'GitHub Actions', 'GitLab', 'Jenkins', 'ArgoCD',
  'Prometheus', 'Grafana', 'OpenTelemetry', 'Datadog',
  'Microservices', 'Distributed systems', 'Event-driven', 'TDD', 'DDD', 'Agile', 'Scrum',
  'Machine learning', 'LLM', 'Spark', 'Airflow', 'Postgres', 'K8s', 'k8s',
];
// Alternate spellings counted under one name.
const SKILL_ALIASES = { golang: 'Go', postgres: 'PostgreSQL', k8s: 'Kubernetes' };

// For every skill (vocab + mine) mentioned in at least one saved job
// description: how many jobs mention it, how many of those reached interview,
// and whether it is in my skills list.
function skillDemand(jobs, mySkills = []) {
  const canon = s => (SKILL_ALIASES[s.toLowerCase()] || s).toLowerCase();
  const mine = new Set(mySkills.map(canon));
  const vocab = [...SKILL_VOCAB, ...mySkills.filter(s => !SKILL_VOCAB.some(v => v.toLowerCase() === s.toLowerCase()))];
  const withJd = jobs.filter(j => (j.jobDescription || '').trim());
  const tally = {};
  for (const j of withJd) {
    const reached = ['interview', 'offer'].includes(j.status) || (j.events || []).some(e => e.type === 'interview');
    const found = new Set(skillMatch(j.jobDescription, vocab).matched.map(m => SKILL_ALIASES[m.toLowerCase()] || m));
    for (const skill of found) {
      const t = tally[skill] || (tally[skill] = { skill, count: 0, interviewed: 0, mine: mine.has(canon(skill)) });
      t.count++;
      if (reached) t.interviewed++;
    }
  }
  const rows = Object.values(tally).sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill));
  return { totalJds: withJd.length, rows };
}

function buildWeeklyRecap(jobs, now = Date.now()) {
  const weekAgo = now - 7 * 86400000;
  const weekAhead = now + 7 * 86400000;
  const inPast = d => d && new Date(d).getTime() >= weekAgo && new Date(d).getTime() <= now;
  const inNext = d => d && new Date(d).getTime() >= now - 86400000 && new Date(d).getTime() <= weekAhead;
  const label  = j => `${j.title} — ${j.company}`;
  const day    = d => new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const applied = jobs.filter(j => inPast(j.appliedDate));
  const moves = { interview: [], offer: [], rejected: [], ghosted: [] };
  for (const j of jobs) {
    for (const e of j.events || []) {
      if (moves[e.type] && inPast(e.date) && !moves[e.type].includes(j)) moves[e.type].push(j);
    }
  }
  const upcoming = [];
  for (const j of jobs) {
    if (['archived', 'rejected', 'ghosted'].includes(j.status)) continue;
    if (inNext(j.interviewDate)) upcoming.push([j.interviewDate, `🎙 Interview: ${label(j)}`]);
    if (inNext(j.deadline))      upcoming.push([j.deadline, `⏰ Deadline: ${label(j)}`]);
    if (inNext(j.followupDate))  upcoming.push([j.followupDate, `📌 Follow up: ${label(j)}`]);
  }
  upcoming.sort((a, b) => new Date(a[0]) - new Date(b[0]));

  const section = (title, list) => list.length ? [`${title} (${list.length})`, ...list.map(j => `  • ${label(j)}`)] : [];
  const active  = jobs.filter(j => ['applied', 'interview', 'offer'].includes(j.status)).length;
  const lines = [
    `Job search recap — ${day(weekAgo)} to ${day(now)}`,
    '',
    ...section('📨 Applied', applied),
    ...section('🗣 Moved to interview', moves.interview),
    ...section('🎉 Offers', moves.offer),
    ...section('❌ Rejected', moves.rejected),
    ...section('👻 Ghosted', moves.ghosted),
  ];
  if (lines.length === 2) lines.push('No activity this week.');
  lines.push('', upcoming.length ? `📅 Next 7 days` : '📅 Nothing scheduled for the next 7 days');
  for (const [d, text] of upcoming) lines.push(`  • ${day(d)} — ${text}`);
  lines.push('', `Active pipeline: ${active} job${active !== 1 ? 's' : ''}`);
  return lines.join('\n');
}

async function copyWeeklyRecap() {
  const text = buildWeeklyRecap(allJobs);
  try {
    await navigator.clipboard.writeText(text);
    showToast('Weekly recap copied to clipboard', 'success');
  } catch {
    showToast('Could not access the clipboard.', 'error');
  }
}

async function checkJobPosting(id) {
  const job = allJobs.find(j => j.id === id);
  if (!job?.url) return null;
  const res = await send('CHECK_POSTING', { id, url: job.url });
  return res?.result || null;
}

async function checkAllPostings() {
  const btn  = document.getElementById('checkPostingsBtn');
  const jobs = allJobs.filter(j => j.url && ['applied', 'interview'].includes(j.status));
  if (!jobs.length) { showToast('No active applications with a posting link.', 'error'); return; }
  btn.disabled = true;
  let closed = 0, unknown = 0;
  for (let i = 0; i < jobs.length; i++) {
    btn.textContent = `🔍 ${i + 1}/${jobs.length}`;
    const r = await checkJobPosting(jobs[i].id);
    if (r?.state === 'closed') closed++;
    if (!r || r.state === 'unknown') unknown++;
  }
  btn.disabled = false;
  btn.textContent = '🔍 Postings';
  await reload();
  showToast(`Checked ${jobs.length} posting${jobs.length !== 1 ? 's' : ''} — ${closed} closed${unknown ? `, ${unknown} couldn't be checked` : ''}`, closed ? 'info' : 'success');
}

function stageSince(j) {
  const entered = (j.events || []).filter(e => e.type === j.status).pop();
  return j.statusUpdated || entered?.date || j.appliedDate;
}

function stageAgeClass(status, days) {
  if (!['applied', 'interview', 'offer'].includes(status)) return '';
  const [warn, late] = status === 'offer' ? [5, 10] : status === 'interview' ? [10, 21] : [14, 30];
  return days >= late ? 'stage-age-late' : days >= warn ? 'stage-age-warn' : '';
}

function lastActivityOf(j) {
  if (j.events && j.events.length) return j.events[j.events.length - 1].date;
  return j.statusUpdated || j.appliedDate;
}

function silentJobs() {
  const days = settings.ghostAfterDays ?? 30;
  if (!days) return [];
  return allJobs.filter(j => j.status === 'applied' && !isSnoozed(j) && daysSince(lastActivityOf(j)) >= days);
}

async function ghostSilentJobs() {
  const jobs = silentJobs();
  if (!jobs.length) return;
  const days = settings.ghostAfterDays ?? 30;
  const list = jobs.slice(0, 10).map(j => `• ${j.title} — ${j.company} (${daysSince(lastActivityOf(j))}d)`).join('\n');
  const more = jobs.length > 10 ? `\n…and ${jobs.length - 10} more` : '';
  if (!confirm(`Mark ${jobs.length} application${jobs.length !== 1 ? 's' : ''} with no activity for ${days}+ days as ghosted?\n\n${list}${more}`)) return;
  const now = new Date().toISOString();
  for (const j of jobs) {
    await send('UPDATE_JOB', { id: j.id, updates: {
      status: 'ghosted', statusUpdated: now, statusReason: j.statusReason || 'No response after apply',
      _note: `Marked ghosted after ${daysSince(lastActivityOf(j))} days of silence`
    } });
  }
  await reload();
  showToast(`👻 ${jobs.length} application${jobs.length !== 1 ? 's' : ''} marked ghosted`, 'success', {
    label: 'Undo',
    onClick: async () => {
      for (const j of jobs) {
        await send('UPDATE_JOB', { id: j.id, updates: { status: 'applied', statusUpdated: j.statusUpdated || null, statusReason: j.statusReason || '', _note: 'Ghosting undone' } });
      }
      await reload();
    }
  });
}

function isSnoozed(j) {
  return !!j.snoozedUntil && new Date(j.snoozedUntil).getTime() > Date.now();
}

async function snoozeJob(id, days) {
  const until = new Date(Date.now() + days * 86400000).toISOString();
  await send('UPDATE_JOB', { id, updates: { snoozedUntil: until } });
  await reload();
  showToast(`Snoozed for ${days} day${days !== 1 ? 's' : ''}`, 'success', {
    label: 'Undo',
    onClick: () => send('UPDATE_JOB', { id, updates: { snoozedUntil: null } }).then(reload)
  });
}

function needsAttention(j) {
  if (isSnoozed(j)) return false;
  const now = Date.now();
  // stale: applied/interview with no activity 14+ days
  const lastActivity = (() => {
    if (j.events && j.events.length) return j.events[j.events.length - 1].date;
    return j.statusUpdated || j.appliedDate;
  })();
  if (['applied', 'interview'].includes(j.status) && (now - new Date(lastActivity).getTime()) / 86400000 >= 14) return true;
  // custom follow-up due or overdue
  if (j.followupDate) {
    const diff = Math.round((new Date(j.followupDate) - now) / 86400000);
    if (diff <= 0 && diff >= -30) return true;
  }
  // email follow-up overdue
  if (j.applicationMethod === 'email' && j.status === 'applied' && !j.followUpSent) {
    const daysAgo = (now - new Date(j.appliedDate).getTime()) / 86400000;
    if (daysAgo >= 7) return true;
  }
  // interview today or tomorrow
  if (j.interviewDate) {
    const diff = Math.round((new Date(j.interviewDate) - now) / 86400000);
    if (diff >= 0 && diff <= 1) return true;
  }
  // deadline within 3 days or overdue (within 7 days)
  if (j.deadline) {
    const diff = Math.round((new Date(j.deadline) - now) / 86400000);
    if (diff <= 3 && diff >= -7) return true;
  }
  return false;
}

function parseSearch(query) {
  const tokens = [];
  const re = /(-)?(?:(\w+)(:|>|<))?(?:"([^"]*)"|(\S+))/g;
  let m;
  while ((m = re.exec(query))) {
    const value = (m[4] ?? m[5] ?? '').toLowerCase();
    if (!value && !m[2]) continue;
    tokens.push({ neg: !!m[1], key: (m[2] || '').toLowerCase(), op: m[3] || '', value });
  }
  return tokens;
}

function searchHasStatus(query) {
  return parseSearch(query).some(t => t.key === 'status' && !t.neg);
}

function jobMatchesToken(j, t) {
  const has = (field, v) => (field || '').toLowerCase().includes(v);
  const v = t.value;
  if (!t.key) {
    if (v.startsWith('#')) return (j.tags || []).some(tag => tag.toLowerCase() === v.slice(1));
    return has(j.title, v) || has(j.company, v) || has(j.notes, v) || has(j.jobDescription, v) ||
      has(j.location, v) || has(j.recruiterName, v) || (j.tags || []).some(tag => has(tag, v));
  }
  switch (t.key) {
    case 'status':   return (j.status || '').startsWith(v);
    case 'tag':      return (j.tags || []).some(tag => tag.toLowerCase() === v.replace(/^#/, ''));
    case 'company':  return has(j.company, v);
    case 'title':    return has(j.title, v);
    case 'loc':
    case 'location': return has(j.location, v);
    case 'type':     return (j.workType || '').toLowerCase().replace(/[^a-z]/g, '').startsWith(v.replace(/[^a-z]/g, ''));
    case 'method':
    case 'source':   return has(j.applicationMethod, v);
    case 'label':    return (LABEL_NAMES[LABEL_COLORS.indexOf(j.colorLabel ?? null)] || '').toLowerCase() === v;
    case 'has': {
      const fields = { interview: j.interviewDate, deadline: j.deadline, followup: j.followupDate, recruiter: j.recruiterName || j.recruiterLinkedin,
        email: j.contactEmail, jd: j.jobDescription, offer: j.offerDetails, qa: (j.interviewQA || []).length, notes: j.notes,
        salary: j.salary, url: j.url, cover: j.coverLetter, prep: j.prepNotes, tasks: (j.todos || []).length };
      return v in fields ? !!fields[v] : false;
    }
    case 'salary': {
      const monthly = monthlySalary(j.salary);
      const n = parseFloat(v.replace(/k$/, '')) * (v.endsWith('k') ? 1000 : 1);
      if (monthly === null || isNaN(n)) return false;
      return t.op === '<' ? monthly < n : monthly >= n;
    }
    case 'older': return daysSince(j.appliedDate) >= parseInt(v, 10);
    case 'newer': return daysSince(j.appliedDate) <= parseInt(v, 10);
    default: {
      const raw = `${t.key}${t.op}${v}`;
      return has(j.title, raw) || has(j.company, raw) || has(j.notes, raw) || has(j.jobDescription, raw);
    }
  }
}

function jobMatchesSearch(j, query) {
  return parseSearch(query).every(t => jobMatchesToken(j, t) !== t.neg);
}

function getFiltered() {
  let jobs = [...allJobs];
  if (currentFilter === 'all') {
    jobs = jobs.filter(j => j.status !== 'archived');
  } else if (currentFilter === 'email') {
    jobs = jobs.filter(j => j.applicationMethod === 'email' && j.status !== 'archived');
  } else if (currentFilter === 'attention') {
    jobs = jobs.filter(j => j.status !== 'archived' && needsAttention(j));
  } else {
    jobs = jobs.filter(j => j.status === currentFilter);
  }
  if (currentSearch) {
    if (searchHasStatus(currentSearch) && currentFilter === 'all') jobs = [...allJobs];
    jobs = jobs.filter(j => jobMatchesSearch(j, currentSearch));
  }
  if (currentTagFilters.size) {
    jobs = jobs.filter(j => [...currentTagFilters].every(t => (j.tags || []).includes(t)));
  }
  if (currentColorFilter !== null) {
    jobs = jobs.filter(j => (j.colorLabel ?? null) === currentColorFilter);
  }
  if (currentWorkTypeFilter) {
    jobs = jobs.filter(j => (j.workType || '') === currentWorkTypeFilter);
  }
  const STATUS_ORDER = { offer: 0, interview: 1, applied: 2, ghosted: 3, rejected: 4, archived: 5 };
  switch (trackerSort) {
    case 'date-asc':  jobs.sort((a, b) => new Date(a.appliedDate) - new Date(b.appliedDate)); break;
    case 'company':   jobs.sort((a, b) => (a.company || '').localeCompare(b.company || '')); break;
    case 'status':    jobs.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)); break;
    case 'priority':  jobs.sort((a, b) => (b.priority || 0) - (a.priority || 0)); break;
    case 'interest':    jobs.sort((a, b) => (b.interest || 0) - (a.interest || 0)); break;
    case 'confidence':  jobs.sort((a, b) => (b.confidence || 0) - (a.confidence || 0)); break;
    case 'deadline':    jobs.sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    }); break;
    default:            jobs.sort((a, b) => new Date(b.appliedDate) - new Date(a.appliedDate)); break;
  }
  // pinned jobs always float to top
  const pinned   = jobs.filter(j => j.pinned);
  const unpinned = jobs.filter(j => !j.pinned);
  return [...pinned, ...unpinned];
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderStats() {
  document.getElementById('sAll').textContent       = allJobs.filter(j => j.status !== 'archived').length;
  document.getElementById('sApplied').textContent   = allJobs.filter(j => j.status === 'applied').length;
  document.getElementById('sInterview').textContent = allJobs.filter(j => j.status === 'interview').length;
  document.getElementById('sOffer').textContent     = allJobs.filter(j => j.status === 'offer').length;
  document.getElementById('sRejected').textContent  = allJobs.filter(j => j.status === 'rejected').length;
  document.getElementById('sGhosted').textContent   = allJobs.filter(j => j.status === 'ghosted').length;
  document.getElementById('sArchived').textContent  = allJobs.filter(j => j.status === 'archived').length;

  const todayStr = new Date().toLocaleDateString('en-CA');
  const todayCount = allJobs.filter(j =>
    j.appliedDate && new Date(j.appliedDate).toLocaleDateString('en-CA') === todayStr
  ).length;
  const todayEl = document.getElementById('sToday');
  if (todayEl) todayEl.textContent = todayCount;
}

// Days from today to an interview date ("YYYY-MM-DD"), by local calendar day.
function daysUntilDate(dateStr, now = new Date()) {
  const [y, m, d] = (dateStr || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(y, m - 1, d) - today) / 86400000);
}

// Interviews in the next two days, with what is still missing to prepare.
function upcomingInterviews(jobs, companyNotes = {}, now = new Date()) {
  return jobs
    .filter(j => !['rejected', 'ghosted', 'archived'].includes(j.status))
    .map(j => ({ j, days: daysUntilDate(j.interviewDate, now) }))
    .filter(x => x.days !== null && x.days >= 0 && x.days <= 2)
    .sort((a, b) => a.days - b.days)
    .map(({ j, days }) => ({
      j, days,
      checks: [
        ['prep notes', !!(j.prepNotes || '').trim()],
        ['Q&A', (j.interviewQA || []).length > 0],
        ['job description', !!(j.jobDescription || '').trim()],
        ['company notes', !!(companyNotes[companyKey(j.company)] || '').toString().trim()],
      ],
    }));
}

async function renderInterviewSoon() {
  const sec = document.getElementById('interviewSoonSection');
  if (!sec) return;
  const res = await send('GET_COMPANY_NOTES');
  const notes = {};
  for (const [k, v] of Object.entries(res?.notes || {})) notes[k] = typeof v === 'string' ? v : (v?.text || '');
  const list = upcomingInterviews(allJobs, notes);
  if (!list.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  sec.innerHTML = `<div class="is-head">🎙 Interview${list.length > 1 ? 's' : ''} coming up</div>` + list.map(({ j, days, checks }) => {
    const when = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : 'In 2 days';
    const missing = checks.filter(c => !c[1]);
    return `
    <div class="is-row">
      <span class="is-when">${when}</span>
      <span><strong>${escHtml(j.title)}</strong> · ${escHtml(j.company)}${j.recruiterName ? ` · with ${escHtml(j.recruiterName)}` : ''}</span>
      <span class="is-ready">${missing.length
        ? `Still to prepare: ${missing.map(c => `<span class="miss">${c[0]}</span>`).join(', ')}`
        : '✓ All prep in place'}</span>
      <span class="is-actions">
        <button class="card-btn" data-soon="brief" data-job-id="${j.id}" title="Printable brief">📄 Brief</button>
        <button class="card-btn" data-soon="qa" data-job-id="${j.id}" title="Interview Q&A">❓ Q&A</button>
        <button class="card-btn" data-soon="company" data-job-id="${j.id}" title="Company profile and notes">🏢</button>
        <button class="card-btn" data-soon="edit" data-job-id="${j.id}" title="Edit prep notes">✏️</button>
      </span>
    </div>`;
  }).join('');
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
  renderSavedViews();
  const COLS = [
    { status: 'applied',   label: 'Applied',   dot: '#2563eb' },
    { status: 'interview', label: 'Interview',  dot: '#16a34a' },
    { status: 'offer',     label: 'Offer',      dot: '#d97706' },
    { status: 'rejected',  label: 'Rejected',   dot: '#dc2626' },
    { status: 'ghosted',   label: 'Ghosted',    dot: '#94a3b8' },
  ];

  const search = currentSearch.toLowerCase();
  const board = document.getElementById('kanbanBoard');

  let dragJobId = null;

  board.innerHTML = COLS.map(col => {
    let jobs = allJobs.filter(j => j.status === col.status);
    if (search) jobs = jobs.filter(j => jobMatchesSearch(j, search));

    const cards = jobs.length === 0
      ? `<div class="kanban-empty">No jobs</div>`
      : jobs.map(j => {
          const days = daysSince(j.appliedDate);
          const daysLabel = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days}d ago`;
          const inStage = daysSince(stageSince(j));
          return `
            <div class="kanban-card" draggable="true" data-job-id="${j.id}">
              <div class="kanban-card-top">
                <div class="kanban-card-title">${j.title}</div>
              </div>
              <div class="kanban-card-company">${j.company}</div>
              <div class="kanban-card-footer">
                <span class="kanban-card-days">📅 ${daysLabel}</span>
                <span class="stage-age ${stageAgeClass(j.status, inStage)}" title="Time in ${j.status}">⏳ ${inStage}d</span>
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
          <span class="kanban-count" title="${jobs.length ? `Average ${Math.round(jobs.reduce((n, j) => n + daysSince(stageSince(j)), 0) / jobs.length)}d in ${col.label.toLowerCase()}` : ''}">${jobs.length}</span>
        </div>
        <div class="kanban-cards" data-drop-status="${col.status}">${cards}</div>
      </div>`;
  }).join('');

  // Drag-and-drop
  board.querySelectorAll('.kanban-card[draggable]').forEach(card => {
    card.addEventListener('dragstart', e => {
      dragJobId = card.dataset.jobId;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });

  board.querySelectorAll('.kanban-cards[data-drop-status]').forEach(zone => {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', async e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const targetStatus = zone.dataset.dropStatus;
      if (!dragJobId || !targetStatus) return;
      const job = allJobs.find(j => j.id === dragJobId);
      if (!job || job.status === targetStatus) return;
      dragJobId = null;
      await quickStatus(job.id, targetStatus);
    });
  });
}

function setViewMode(mode) {
  viewMode = mode;
  document.getElementById('viewList').classList.toggle('active', mode === 'list');
  document.getElementById('viewKanban').classList.toggle('active', mode === 'kanban');
  document.getElementById('jobsGrid').style.display    = mode === 'list'   ? '' : 'none';
  document.getElementById('kanbanBoard').style.display = mode === 'kanban' ? '' : 'none';
  if (mode === 'kanban') renderKanban(); else renderJobs();
}

function renderOfferCompare() {
  const el = document.getElementById('offerCompare');
  const offers = allJobs.filter(j => j.status === 'offer');
  if (offers.length < 2) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = `
    <div class="offer-compare-wrap">
      <div class="offer-compare-title">🎉 You have ${offers.length} offers — compare them:</div>
      <div class="offer-cards">
        ${offers.map(j => `
          <div class="offer-card">
            <div class="offer-card-company">${j.company}</div>
            <div class="offer-card-title">${j.title}</div>
            ${j.salary ? `<div class="offer-card-row">💰 ${j.salary}</div>` : ''}
            ${j.applicationMethod ? `<div class="offer-card-row">📬 ${j.applicationMethod}</div>` : ''}
            ${j.tags && j.tags.length ? `<div class="offer-card-row">🏷 ${j.tags.map(t => '#' + t).join(' ')}</div>` : ''}
            ${j.offerDetails ? `<div class="offer-card-row" style="color:#166534;white-space:pre-wrap">${j.offerDetails.slice(0, 120)}${j.offerDetails.length > 120 ? '…' : ''}</div>` : ''}
            ${j.notes ? `<div class="offer-card-row" style="color:#64748b;font-style:italic">${j.notes.slice(0, 80)}${j.notes.length > 80 ? '…' : ''}</div>` : ''}
          </div>`).join('')}
      </div>
    </div>`;
}

function renderJobs() {
  renderOfferCompare();
  renderSavedViews();
  renderDuplicatesBtn();
  // Update attention badge count
  const attentionN = allJobs.filter(j => j.status !== 'archived' && needsAttention(j)).length;
  const countEl = document.getElementById('attentionCount');
  if (countEl) countEl.textContent = attentionN > 0 ? `(${attentionN})` : '';
  const tabEl = document.getElementById('attentionTab');
  if (tabEl) {
    tabEl.style.background = currentFilter === 'attention' ? '#d97706' : attentionN > 0 ? '#fef3c7' : '';
    tabEl.style.borderColor = attentionN > 0 ? '#fcd34d' : '';
    tabEl.style.color = currentFilter === 'attention' ? '#fff' : attentionN > 0 ? '#92400e' : '';
    tabEl.style.display = attentionN > 0 || currentFilter === 'attention' ? '' : 'none';
  }
  const ghostBtn = document.getElementById('ghostSilentBtn');
  if (ghostBtn) {
    const silentN = silentJobs().length;
    ghostBtn.style.display = silentN > 0 ? '' : 'none';
    document.getElementById('ghostSilentCount').textContent = silentN > 0 ? `(${silentN})` : '';
  }
  // Active tag filter chips
  const tagChipsEl = document.getElementById('activeTagFilters');
  if (tagChipsEl) {
    tagChipsEl.innerHTML = currentTagFilters.size
      ? [...currentTagFilters].map(t => `<span class="active-tag-chip" data-remove-tag="${t}">#${t} ✕</span>`).join('')
        + `<span class="active-tag-chip active-tag-clear" data-clear-tags>Clear tags</span>`
      : '';
  }
  // Color label filter dots
  const colorBarEl = document.getElementById('colorFilterBar');
  if (colorBarEl) {
    colorBarEl.innerHTML =
      `<span class="color-filter-label">Label:</span>`
      + LABEL_COLORS.slice(1).map((c, i) =>
          `<button class="color-dot-btn${currentColorFilter === c ? ' color-dot-active' : ''}" data-color-filter="${c}" title="${LABEL_NAMES[i + 1]}" style="background:${c}"></button>`
        ).join('')
      + (currentColorFilter
          ? `<button class="color-dot-clear" data-clear-color>✕ Clear</button>`
          : '');
  }
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

  const byCompany = groupByCompany(allJobs);
  grid.innerHTML = jobs.map(j => {
    const events   = (j.events || []).slice(-3).reverse();
    const sameCompany = (byCompany.get(companyKey(j.company)) || []).filter(o => o.id !== j.id);
    const daysAgo  = daysSince(j.appliedDate);
    const followupDue = j.applicationMethod === 'email' && j.status === 'applied' &&
      !j.followUpSent && daysAgo >= (settings.followUpDays || 7);

    const lastActivityDate = (() => {
      if (j.events && j.events.length) return j.events[j.events.length - 1].date;
      return j.statusUpdated || j.appliedDate;
    })();
    const snoozed = isSnoozed(j);
    const stale = !snoozed && ['applied', 'interview'].includes(j.status) && daysSince(lastActivityDate) >= 14;

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
      <div class="job-card" id="card-${j.id}" data-job-id="${j.id}" data-status="${j.status}" style="${j.pinned ? 'border-top:2px solid #f59e0b;' : ''}${j.colorLabel ? 'border-left:3px solid ' + j.colorLabel + ';' : ''}">
        <label style="position:absolute;top:10px;right:10px;cursor:pointer;display:none" class="bulk-check">
          <input type="checkbox" data-select-id="${j.id}" style="width:15px;height:15px;cursor:pointer" ${selectedIds.has(j.id) ? 'checked' : ''}>
        </label>
        <div class="card-header">
          <div class="card-avatar" style="${avatarStyle(j.company)}">${initials(j.company)}</div>
          <div class="card-main">
            <div class="card-title">${j.title}</div>
            <div class="card-company"><span class="company-link" data-action="company" data-job-id="${j.id}" title="Company profile &amp; notes">${j.company}</span>${sameCompany.length ? ` <span class="company-history" data-action="company-history" data-job-id="${j.id}" title="${sameCompany.map(o => `${o.title} — ${o.status} (${fmtDate(o.appliedDate)})`).join('&#10;').replace(/"/g, '&quot;')}">🏢 +${sameCompany.length} here</span>` : ''}</div>
            <div class="priority-stars" data-job-id="${j.id}">${[1,2,3].map(n => `<span class="pstar${(j.priority||0) >= n ? ' pstar-on' : ''}" data-star="${n}" title="${n === 1 ? 'Low' : n === 2 ? 'Medium' : 'High'} priority">★</span>`).join('')}</div>
            <div class="interest-hearts" data-job-id="${j.id}">${[1,2,3,4,5].map(n => `<span class="iheart${(j.interest||0) >= n ? ' iheart-on' : ''}" data-heart="${n}" title="${n === 1 ? 'Meh' : n === 2 ? 'OK' : n === 3 ? 'Like' : n === 4 ? 'Want' : 'Dream job'}">♥</span>`).join('')}</div>
            <div class="conf-emojis" data-job-id="${j.id}">${['😬','😐','🙂','😊','🚀'].map((em,i) => `<span class="cemoji${(j.confidence||0) >= i+1 ? ' cemoji-on' : ''}" data-conf="${i+1}" title="${['Low','Uncertain','Neutral','Hopeful','Very confident'][i]}">${em}</span>`).join('')}</div>
          </div>
          <div class="card-badge">
            <span class="badge ${STATUS_BADGE[j.status] || 'badge-applied'}">${j.status}</span>
            ${stale ? `<span class="badge-stale">🕰 stale</span>` : ''}
            ${j.statusUpdated ? `<span style="font-size:10px;color:#94a3b8;display:block;text-align:right;margin-top:3px">${daysSince(j.statusUpdated)}d</span>` : ''}
            <span data-action="cycle-label" data-job-id="${j.id}" title="Color label: ${LABEL_NAMES[LABEL_COLORS.indexOf(j.colorLabel ?? null)] ?? 'None'} — click to change" style="display:block;width:12px;height:12px;border-radius:50%;margin:5px 0 0 auto;cursor:pointer;${j.colorLabel ? 'background:' + j.colorLabel : 'background:transparent;border:1.5px solid #475569'}"></span></div>
        </div>

        <div class="card-body">
          <div class="card-meta">
            <div class="meta-item">📅 ${fmtDate(j.appliedDate)}</div>
            <div class="meta-item">${methodIcon}</div>
            ${j.salary ? salaryMeta(j) : ''}
            ${j.workType ? `<div class="meta-item">${j.workType === 'Remote' ? '🏠' : j.workType === 'Hybrid' ? '🔀' : '🏢'} ${j.workType}</div>` : ''}
            ${j.location ? `<div class="meta-item">📍 ${j.location}</div>` : ''}
            ${j.resumeVersion ? `<div class="meta-item" title="Resume version">📄 ${j.resumeVersion}</div>` : ''}
            ${(() => {
              const m = skillMatch(j.jobDescription, settings.mySkills);
              if (!m) return '';
              const color = m.pct >= 70 ? '#16a34a' : m.pct >= 40 ? '#d97706' : '#dc2626';
              const tip = `Matched: ${m.matched.join(', ') || '—'}&#10;Missing: ${m.missing.join(', ') || '—'}`.replace(/"/g, '&quot;');
              return `<div class="meta-item" title="${tip}" style="color:${color};font-weight:600;cursor:help">🎯 ${m.matched.length}/${m.matched.length + m.missing.length} skills</div>`;
            })()}
            ${j.recruiterName ? `<div class="meta-item">👤 ${j.recruiterLinkedin ? `<a href="${j.recruiterLinkedin}" target="_blank" style="color:#2563eb;text-decoration:none">${j.recruiterName}</a>` : j.recruiterName}</div>` : ''}
            ${j.url ? `<div class="meta-item"><a href="${j.url}" target="_blank" style="color:#2563eb;text-decoration:none">🔗 View Job</a></div>` : ''}
          </div>
          ${j.tags && j.tags.length ? `<div class="card-tags">${j.tags.map(t => `<span class="card-tag${currentTagFilters.has(t) ? ' card-tag-active' : ''}" data-tag="${t}">#${t}</span>`).join('')}</div>` : ''}
          ${(function() {
            if (!j.interviewDate) return '';
            const diff = Math.round((new Date(j.interviewDate) - Date.now()) / 86400000);
            if (diff < -1) return '';
            const label = diff < 0 ? 'was yesterday' : diff === 0 ? 'is today!' : diff === 1 ? 'is tomorrow' : `in ${diff} days`;
            const cls = diff <= 1 ? 'alert-strip alert-green' : 'alert-strip alert-blue';
            return `<div class="${cls}" style="font-weight:600">📅 Interview ${label}</div>`;
          })()}
          ${(function() {
            if (!j.followupDate) return '';
            const diff = Math.round((new Date(j.followupDate) - Date.now()) / 86400000);
            if (diff < -30) return '';
            if (diff < 0)  return `<div class="alert-strip alert-red" style="display:flex;align-items:center;justify-content:space-between;font-weight:600">📌 Follow-up overdue by ${Math.abs(diff)}d<button class="card-btn" data-action="clear-followup" data-job-id="${j.id}" style="font-size:11px;padding:2px 8px;margin:0">Clear</button></div>`;
            if (diff === 0) return `<div class="alert-strip alert-green" style="font-weight:600">📌 Follow-up due today!</div>`;
            return `<div class="alert-strip alert-blue">📌 Follow-up in ${diff}d — ${new Date(j.followupDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>`;
          })()}
          ${(function() {
            if (!j.deadline) return '';
            const diff = Math.round((new Date(j.deadline) - Date.now()) / 86400000);
            if (diff < -14) return '';
            if (diff < 0)  return `<div class="alert-strip alert-red" style="font-weight:600">⏰ Deadline passed ${Math.abs(diff)}d ago</div>`;
            if (diff === 0) return `<div class="alert-strip alert-red" style="font-weight:600">⏰ Apply by today!</div>`;
            if (diff === 1) return `<div class="alert-strip alert-red" style="font-weight:600">⏰ Deadline tomorrow!</div>`;
            const label = new Date(j.deadline).toLocaleDateString('en-US',{month:'short',day:'numeric'});
            const cls = diff <= 3 ? 'alert-strip alert-yellow' : 'alert-strip alert-blue';
            return `<div class="${cls}">⏰ Deadline in ${diff}d — ${label}</div>`;
          })()}
          ${stale ? `<div class="alert-strip alert-yellow" style="display:flex;align-items:center;justify-content:space-between">🕰 No activity for ${daysSince(lastActivityDate)} days<button class="card-btn" data-action="archive-stale" data-job-id="${j.id}" style="font-size:11px;padding:2px 8px;margin:0">Archive</button></div>` : ''}
          ${j.postingState === 'closed' && ['applied', 'interview'].includes(j.status) ? `<div class="alert-strip alert-red" title="Checked ${fmtDate(j.postingCheckedAt)}${j.postingReason ? ' — ' + j.postingReason.replace(/"/g, '&quot;') : ''}">🚫 Posting looks closed</div>` : ''}
          ${snoozed ? `<div class="alert-strip alert-blue" style="display:flex;align-items:center;justify-content:space-between">💤 Snoozed until ${new Date(j.snoozedUntil).toLocaleDateString('en-US',{month:'short',day:'numeric'})}<button class="card-btn" data-action="unsnooze" data-job-id="${j.id}" style="font-size:11px;padding:2px 8px;margin:0">Wake</button></div>` : ''}
          ${followupDue && !snoozed ? `<div class="alert-strip alert-yellow">⏰ Follow-up overdue — ${daysAgo} days with no response</div>` : ''}
          ${j.statusReason ? `<div style="font-size:12px;color:#94a3b8;font-style:italic;padding:0 16px 6px">↳ ${j.statusReason}</div>` : ''}
          ${j.notes ? `<div class="card-notes">${j.notes}</div>` : ''}
          ${j.jobDescription ? `
            <span class="card-prep-toggle" data-jd-id="${j.id}">📄 Job Description ▾</span>
            <div class="card-prep" id="jd-${j.id}" style="display:none;margin:0 16px 10px;color:#64748b">${j.jobDescription.replace(/\n/g,'<br>')}</div>` : ''}
          ${j.prepNotes ? `
            <span class="card-prep-toggle" data-prep-id="${j.id}">📋 Interview Prep ▾</span>
            <div class="card-prep" id="prep-${j.id}" style="display:none;margin:0 16px 10px">${j.prepNotes.replace(/\n/g,'<br>')}</div>` : ''}
          ${j.coverLetter ? `
            <span class="card-prep-toggle" data-cl-id="${j.id}">✉ Cover Letter ▾</span>
            <div class="card-prep" id="cl-${j.id}" style="display:none;margin:0 16px 10px;color:#475569">${j.coverLetter.replace(/\n/g,'<br>')}</div>` : ''}
          ${j.offerDetails ? `
            <span class="card-prep-toggle" data-od-id="${j.id}">💰 Offer Details ▾</span>
            <div class="card-prep" id="od-${j.id}" style="display:none;margin:0 16px 10px;color:#166534;background:#f0fdf4;border-radius:6px;padding:8px 12px">${j.offerDetails.replace(/\n/g,'<br>')}</div>` : ''}
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
          <button class="card-btn" data-action="qa" data-job-id="${j.id}" title="Interview Q&A prep">❓ Q&A${j.interviewQA?.length ? ` (${j.interviewQA.length})` : ''}</button>
          <button class="card-btn" data-action="todos" data-job-id="${j.id}" title="Job tasks">${(()=>{ const todos=j.todos||[]; return todos.length ? `☑ ${todos.filter(t=>t.done).length}/${todos.length}` : '☑ Tasks'; })()}</button>
          ${['interview','offer'].includes(j.status) ? `<button class="card-btn" data-action="add-round" data-job-id="${j.id}" title="Log an interview round">🎙 Round</button>` : ''}
          ${['interview', 'offer'].includes(j.status) ? `<button class="card-btn" data-action="thank-you" data-job-id="${j.id}" title="${j.thankYouSentAt ? `Thank-you sent ${fmtDate(j.thankYouSentAt)}` : 'Draft a thank-you note'}"${j.thankYouSentAt ? ' style="color:#16a34a"' : ''}>💌${j.thankYouSentAt ? ' ✓' : ''}</button>` : ''}
          ${j.status === 'rejected' ? `<button class="card-btn" data-action="feedback" data-job-id="${j.id}" title="${j.feedbackRequestedAt ? `Feedback requested ${fmtDate(j.feedbackRequestedAt)}` : 'Ask the recruiter for feedback'}"${j.feedbackRequestedAt ? ' style="color:#16a34a"' : ''}>🙏${j.feedbackRequestedAt ? ' ✓' : ' Feedback'}</button>` : ''}
          ${j.applicationMethod === 'email' ? `<button class="card-btn" data-action="followup" data-job-id="${j.id}">📧 Follow-up</button>` : ''}
          <a class="card-btn" href="https://www.glassdoor.com/Search/results.htm?keyword=${encodeURIComponent(j.company)}" target="_blank" title="Glassdoor reviews" style="text-decoration:none;display:flex;align-items:center;justify-content:center">🌟</a>
          <a class="card-btn" href="https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(j.company)}" target="_blank" title="LinkedIn company" style="text-decoration:none;display:flex;align-items:center;justify-content:center">🔗</a>
          <a class="card-btn" href="https://www.levels.fyi/companies/${encodeURIComponent(j.company.toLowerCase().replace(/\s+/g,'-'))}/salaries/" target="_blank" title="Levels.fyi salaries" style="text-decoration:none;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">💲</a>
          <button class="card-btn" data-action="toggle-pin" data-job-id="${j.id}" title="${j.pinned ? 'Unpin' : 'Pin to top'}" style="${j.pinned ? 'color:#f59e0b' : ''}">${j.pinned ? '📌' : '📍'}</button>
          ${j.interviewDate || j.deadline || j.followupDate ? `<button class="card-btn" data-action="calendar" data-job-id="${j.id}" title="Add interview / deadline / follow-up to calendar">🗓</button>` : ''}
          ${!snoozed && needsAttention(j) ? `<select class="card-btn" data-action="snooze" data-job-id="${j.id}" title="Hide from Needs Attention for a while" style="cursor:pointer"><option value="">💤</option><option value="3">3 days</option><option value="7">1 week</option><option value="14">2 weeks</option></select>` : ''}
          ${j.url ? `<button class="card-btn" data-action="check-posting" data-job-id="${j.id}" title="${j.postingCheckedAt ? `Posting ${j.postingState} — checked ${fmtDate(j.postingCheckedAt)}` : 'Check if the posting is still open'}">🔍</button>` : ''}
          <button class="card-btn" data-action="brief" data-job-id="${j.id}" title="Open a printable interview brief">📄</button>
          <button class="card-btn" data-action="copy" data-job-id="${j.id}" title="Copy job details">📋</button>
          <button class="card-btn" data-action="duplicate" data-job-id="${j.id}" title="Duplicate this application">⊕</button>
          <button class="card-btn danger" data-action="delete" data-job-id="${j.id}">🗑</button>
        </div>
      </div>`;
  }).join('');
}

// ── Job actions ──────────────────────────────────────────────────────────────

let companyModalKey = null;
let companyNoteTimer = null;

async function openCompanyModal(jobId) {
  const job = allJobs.find(j => j.id === jobId);
  if (!job) return;
  companyModalKey = companyKey(job.company);
  const jobs = allJobs.filter(j => companyKey(j.company) === companyModalKey)
    .sort((a, b) => new Date(b.appliedDate) - new Date(a.appliedDate));
  const res = await send('GET_COMPANY_NOTES');
  const note = res?.notes?.[companyModalKey];
  const contacts = collectContacts(jobs);
  const responded = jobs.filter(j => ['interview', 'offer'].includes(j.status) || (j.events || []).some(e => ['interview', 'offer', 'round'].includes(e.type))).length;
  const name = job.company;
  const enc = encodeURIComponent(name);

  document.getElementById('companyModalTitle').textContent = `🏢 ${name}`;
  document.getElementById('companyNoteSaved').textContent = note ? `Notes updated ${fmtDate(note.updated)}` : '';
  document.getElementById('companyModalBody').innerHTML = `
    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#64748b;margin-bottom:12px">
      <span><b style="color:#1e293b">${jobs.length}</b> application${jobs.length !== 1 ? 's' : ''}</span>
      <span><b style="color:#1e293b">${responded}</b> reached interview</span>
      <span>first applied ${escHtml(fmtDate(jobs[jobs.length - 1].appliedDate))}</span>
    </div>
    <label class="form-label">Company notes <span style="font-weight:400;color:#94a3b8">(shared by every application here — culture, stack, people, salary intel)</span></label>
    <textarea id="companyNoteInput" rows="5" placeholder="Tech stack, interview process, people you've talked to, what to avoid…"
      style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;resize:vertical;box-sizing:border-box;font-family:inherit">${escHtml(note?.text || '')}</textarea>
    <div style="font-size:13px;font-weight:600;color:#475569;margin:14px 0 6px">Applications</div>
    ${jobs.map(j => `
      <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:5px 0;border-bottom:1px solid #f1f5f9">
        <span>${escHtml(j.title)}${j.statusReason ? `<span style="color:#94a3b8;font-size:11px"> — ${escHtml(j.statusReason)}</span>` : ''}</span>
        <span style="white-space:nowrap;color:#64748b;font-size:12px">${escHtml(j.status)} · ${escHtml(fmtDate(j.appliedDate))}</span>
      </div>`).join('')}
    ${contacts.length ? `
      <div style="font-size:13px;font-weight:600;color:#475569;margin:14px 0 6px">People</div>
      ${contacts.map(c => `<div style="font-size:13px;padding:3px 0">${escHtml(c.name || c.email || c.linkedin)}${c.email && c.name ? ` <span style="color:#94a3b8">· ${escHtml(c.email)}</span>` : ''}</div>`).join('')}` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
      <a class="card-btn" style="text-decoration:none" target="_blank" href="https://www.glassdoor.com/Search/results.htm?keyword=${enc}">🌟 Glassdoor</a>
      <a class="card-btn" style="text-decoration:none" target="_blank" href="https://www.linkedin.com/search/results/companies/?keywords=${enc}">🔗 LinkedIn</a>
      <a class="card-btn" style="text-decoration:none" target="_blank" href="https://www.linkedin.com/search/results/people/?keywords=${enc}%20recruiter">👥 Recruiters</a>
      <a class="card-btn" style="text-decoration:none" target="_blank" href="https://www.google.com/search?q=${enc}%20engineering%20blog">📰 Eng blog</a>
    </div>`;

  document.getElementById('companyNoteInput').addEventListener('input', e => {
    clearTimeout(companyNoteTimer);
    const key = companyModalKey, text = e.target.value.trim();
    document.getElementById('companyNoteSaved').textContent = 'Saving…';
    companyNoteTimer = setTimeout(async () => {
      await send('SAVE_COMPANY_NOTE', { key, text });
      document.getElementById('companyNoteSaved').textContent = text ? 'Saved' : 'Notes cleared';
    }, 600);
  });
  document.getElementById('companyModal').style.display = 'flex';
}

function closeCompanyModal() {
  document.getElementById('companyModal').style.display = 'none';
  companyModalKey = null;
}

function statusSnapshot(j) {
  return {
    id: j.id,
    updates: {
      status: j.status,
      statusUpdated: j.statusUpdated || null,
      statusReason: j.statusReason || '',
      archivedFrom: j.archivedFrom || null,
      events: [...(j.events || [])]
    }
  };
}

async function restoreSnapshots(snapshots) {
  for (const snap of snapshots) await send('UPDATE_JOB', { id: snap.id, updates: snap.updates });
  document.getElementById('reasonModal').style.display = 'none';
  await reload();
  showToast(`Undone — ${snapshots.length === 1 ? 'status restored' : `${snapshots.length} jobs restored`}`, 'success');
}

async function quickStatus(id, status) {
  const prev = allJobs.find(j => j.id === id);
  if (!prev || prev.status === status) return;
  const snapshot = statusSnapshot(prev);
  await send('UPDATE_JOB', { id, updates: { status, statusUpdated: new Date().toISOString(), archivedFrom: null } });
  if (status === 'offer') {
    launchConfetti();
    showToast('🎉 Congratulations on the offer!', 'success');
  }
  await reload();
  showToast(`${prev.company}: ${prev.status} → ${status}`, 'info', { label: 'Undo', onClick: () => restoreSnapshots([snapshot]) });
  if (status === 'rejected' || status === 'ghosted') promptStatusReason(id, status);
}

function promptStatusReason(jobId, status) {
  if (!REASON_OPTIONS[status]) return;
  const modal = document.getElementById('reasonModal');
  const chipsEl = document.getElementById('reasonChips');
  const custom = document.getElementById('reasonCustom');
  document.getElementById('reasonModalTitle').textContent =
    status === 'rejected' ? 'Why was this rejected?' : 'Why did this go quiet?';
  custom.value = '';
  let selected = '';
  chipsEl.innerHTML = REASON_OPTIONS[status].map(r =>
    `<button class="reason-chip" data-reason="${r}">${r}</button>`
  ).join('');
  chipsEl.querySelectorAll('.reason-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      chipsEl.querySelectorAll('.reason-chip').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selected = btn.dataset.reason;
      custom.value = '';
    });
  });
  modal.style.display = 'flex';
  const close = () => { modal.style.display = 'none'; };
  const save = async () => {
    const reason = custom.value.trim() || selected;
    if (reason) {
      await send('UPDATE_JOB', { id: jobId, updates: { statusReason: reason } });
      await reload();
    }
    close();
  };
  document.getElementById('saveReasonBtn').onclick = save;
  document.getElementById('skipReasonBtn').onclick = close;
  document.getElementById('closeReasonBtn').onclick = close;
  modal.onclick = e => { if (e.target === modal) close(); };
}

// ── Global Search ─────────────────────────────────────────────────────────────

async function openGlobalSearch() {
  try { const { items } = await send('GET_WISHLIST', {}); globalSearchWishlist = items || []; }
  catch { globalSearchWishlist = []; }
  const modal = document.getElementById('globalSearchModal');
  modal.style.display = 'flex';
  const input = document.getElementById('globalSearchInput');
  input.value = '';
  input.focus();
  renderGlobalResults('');
}

function closeGlobalSearch() {
  document.getElementById('globalSearchModal').style.display = 'none';
}

function renderGlobalResults(query) {
  const q = query.toLowerCase().trim();
  const el = document.getElementById('globalSearchResults');
  if (!q) {
    el.innerHTML = `<div class="gs-empty">Type to search across jobs and wishlist…</div>`;
    return;
  }
  const hit = s => (s || '').toLowerCase().includes(q);
  const trackerHits = allJobs.filter(j => hit(j.title) || hit(j.company) || hit(j.notes) || hit((j.tags || []).join(' ')));
  const wishlistHits = globalSearchWishlist.filter(w => hit(w.company) || hit(w.title) || hit(w.notes));
  if (!trackerHits.length && !wishlistHits.length) {
    el.innerHTML = `<div class="gs-empty">No results for "<strong>${query}</strong>"</div>`;
    return;
  }
  el.innerHTML = [
    ...trackerHits.map(j => `
      <div class="gs-result" data-gs-type="tracker" data-gs-id="${j.id}" data-gs-company="${j.company}">
        <div class="gs-result-avatar" style="${avatarStyle(j.company)}">${initials(j.company)}</div>
        <div class="gs-result-main">
          <div class="gs-result-title">${j.title}</div>
          <div class="gs-result-sub">${j.company} · ${j.status}</div>
        </div>
        <span class="gs-source gs-source-tracker">📋 Tracker</span>
      </div>`),
    ...wishlistHits.map(w => `
      <div class="gs-result" data-gs-type="wishlist">
        <div class="gs-result-avatar" style="${avatarStyle(w.company)}">${initials(w.company)}</div>
        <div class="gs-result-main">
          <div class="gs-result-title">${w.title || 'Role not specified'}</div>
          <div class="gs-result-sub">${w.company} · Wishlist target</div>
        </div>
        <span class="gs-source gs-source-wishlist">⭐ Wishlist</span>
      </div>`),
  ].join('');
}

// ── Interview Q&A ─────────────────────────────────────────────────────────────

let qaCurrentJobId  = null;
let todosJobId      = null;

function openQaModal(jobId) {
  const job = allJobs.find(j => j.id === jobId);
  if (!job) return;
  qaCurrentJobId = jobId;
  document.getElementById('qaModalTitle').textContent = `${job.company} — Interview Q&A`;
  renderQaModal();
  document.getElementById('qaModal').style.display = 'flex';
  document.getElementById('qaNewQ').focus();
}

function closeQaModal() {
  document.getElementById('qaModal').style.display = 'none';
  qaCurrentJobId = null;
}

const STATUS_RANK = { offer: 6, interview: 5, applied: 4, ghosted: 3, rejected: 2, archived: 1 };

function findDuplicateGroups(jobs) {
  const normTitle = t => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normUrl   = u => (u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  const parent = new Map(jobs.map(j => [j.id, j.id]));
  const find = id => parent.get(id) === id ? id : (parent.set(id, find(parent.get(id))), parent.get(id));
  const union = (a, b) => parent.set(find(a), find(b));
  const seen = new Map();
  for (const j of jobs) {
    const keys = [`t:${companyKey(j.company)}|${normTitle(j.title)}`];
    if (normUrl(j.url).length > 8) keys.push(`u:${normUrl(j.url)}`);
    for (const k of keys) {
      if (seen.has(k)) union(j.id, seen.get(k)); else seen.set(k, j.id);
    }
  }
  const groups = new Map();
  for (const j of jobs) {
    const root = find(j.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(j);
  }
  const dismissed = g => g.every((a, i) => g.every((b, k) => i === k || (a.notDuplicateOf || []).includes(b.id)));
  return [...groups.values()].filter(g => g.length > 1 && !dismissed(g)).map(g => g.sort((a, b) =>
    (STATUS_RANK[b.status] || 0) - (STATUS_RANK[a.status] || 0) ||
    new Date(lastActivityOf(b)) - new Date(lastActivityOf(a))));
}

function mergeJobs(primary, others) {
  const merged = { ...primary };
  const empty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
  for (const o of others) {
    for (const [k, v] of Object.entries(o)) {
      if (k === 'id' || empty(v)) continue;
      if (empty(merged[k])) { merged[k] = v; continue; }
      if (['notes', 'prepNotes'].includes(k) && typeof v === 'string' && !merged[k].includes(v)) merged[k] = `${merged[k]}\n\n${v}`;
    }
    merged.tags = [...new Set([...(merged.tags || []), ...(o.tags || [])])];
    const qs = new Set((merged.interviewQA || []).map(x => x.q.toLowerCase().trim()));
    merged.interviewQA = [...(merged.interviewQA || []), ...(o.interviewQA || []).filter(x => !qs.has(x.q.toLowerCase().trim()))];
    const todoTexts = new Set((merged.todos || []).map(t => t.text));
    merged.todos = [...(merged.todos || []), ...(o.todos || []).filter(t => !todoTexts.has(t.text))];
    merged.events = [...(merged.events || []), ...(o.events || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
    if (o.appliedDate && new Date(o.appliedDate) < new Date(merged.appliedDate)) merged.appliedDate = o.appliedDate;
  }
  merged.status = primary.status;
  return merged;
}

function renderDuplicatesBtn() {
  const btn = document.getElementById('duplicatesBtn');
  if (!btn) return;
  const n = findDuplicateGroups(allJobs).length;
  btn.style.display = n ? '' : 'none';
  document.getElementById('duplicatesCount').textContent = n ? `(${n})` : '';
}

function renderDupesModal() {
  const groups = findDuplicateGroups(allJobs);
  const list = document.getElementById('dupesList');
  list.innerHTML = groups.length ? groups.map((g, gi) => `
    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:10px">
      ${g.map((j, i) => `
        <div style="display:flex;align-items:center;gap:8px;font-size:13px;padding:3px 0">
          <span style="width:14px;color:#f59e0b">${i === 0 ? '★' : ''}</span>
          <span style="flex:1;min-width:0"><b>${escHtml(j.title)}</b> — ${escHtml(j.company)}
            <span style="color:#94a3b8;font-size:11px">· ${escHtml(j.status)} · applied ${escHtml(fmtDate(j.appliedDate))}</span></span>
        </div>`).join('')}
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">
        <button class="card-btn" data-dupe-ignore="${gi}" title="These are separate applications">Not duplicates</button>
        <button class="card-btn" data-dupe-merge="${gi}" style="color:#2563eb;font-weight:600">Merge ${g.length} → 1</button>
      </div>
    </div>`).join('') : '<div style="text-align:center;color:#94a3b8;font-size:13px;padding:20px">No duplicates found 🎉</div>';
}

function openDupesModal() {
  renderDupesModal();
  document.getElementById('dupesModal').style.display = 'flex';
}

function closeDupesModal() {
  document.getElementById('dupesModal').style.display = 'none';
}

function buildJobBrief(j) {
  const e  = t => escHtml(t).replace(/\n/g, '<br>');
  const row = (label, value) => value ? `<tr><th>${label}</th><td>${value}</td></tr>` : '';
  const section = (title, body) => body ? `<h2>${title}</h2>${body}` : '';
  const rounds = (j.events || []).filter(ev => ev.type === 'round');
  const todos  = (j.todos || []).filter(t => !t.done);
  const match  = skillMatch(j.jobDescription, settings.mySkills);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(j.company)} — ${escHtml(j.title)} brief</title>
<style>
  body { font: 14px/1.55 -apple-system, Segoe UI, Roboto, sans-serif; color: #1e293b; max-width: 780px; margin: 32px auto; padding: 0 20px; }
  h1 { font-size: 24px; margin: 0; } .sub { color: #64748b; margin: 4px 0 18px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .05em; color: #2563eb; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-top: 26px; }
  table { border-collapse: collapse; width: 100%; } th { text-align: left; color: #64748b; font-weight: 600; width: 150px; padding: 3px 0; vertical-align: top; } td { padding: 3px 0; }
  .qa { margin-bottom: 12px; } .qa b { display: block; } .chip { display: inline-block; padding: 1px 8px; margin: 2px; border-radius: 999px; font-size: 12px; }
  .ok { background: #dcfce7; color: #166534; } .miss { background: #fee2e2; color: #991b1b; }
  .hint { color: #94a3b8; font-size: 12px; } @media print { .hint { display: none; } body { margin: 0 auto; } }
</style></head><body>
<p class="hint">Press Ctrl+P (⌘P on Mac) to print or save as PDF.</p>
<h1>${escHtml(j.title)}</h1>
<div class="sub">${escHtml(j.company)}${j.location ? ' · ' + escHtml(j.location) : ''}${j.workType ? ' · ' + escHtml(j.workType) : ''}</div>
<table>
  ${row('Status', escHtml(j.status))}
  ${row('Applied', escHtml(fmtDate(j.appliedDate)))}
  ${row('Interview', j.interviewDate ? escHtml(fmtDate(j.interviewDate)) : '')}
  ${row('Salary', escHtml(j.salary))}
  ${row('Recruiter', escHtml([j.recruiterName, j.contactEmail].filter(Boolean).join(' · ')))}
  ${row('Resume sent', escHtml(j.resumeVersion))}
  ${row('Posting', j.url ? escHtml(j.url) : '')}
</table>
${section('Interview rounds', rounds.length ? `<ul>${rounds.map(r => `<li>${escHtml(fmtDate(r.date))} — ${e(r.note)}</li>`).join('')}</ul>` : '')}
${section('Prep notes', j.prepNotes ? `<p>${e(j.prepNotes)}</p>` : '')}
${section('Questions &amp; answers', (j.interviewQA || []).map(x => `<div class="qa"><b>${e(x.q)}</b>${x.a ? e(x.a) : '<span class="hint">No answer prepared</span>'}</div>`).join(''))}
${section('Skills match', match ? match.matched.map(s => `<span class="chip ok">${escHtml(s)}</span>`).join('') + match.missing.map(s => `<span class="chip miss">${escHtml(s)}</span>`).join('') : '')}
${section('Open tasks', todos.length ? `<ul>${todos.map(t => `<li>${e(t.text)}</li>`).join('')}</ul>` : '')}
${section('Notes', j.notes ? `<p>${e(j.notes)}</p>` : '')}
${section('Offer details', j.offerDetails ? `<p>${e(j.offerDetails)}</p>` : '')}
${section('Job description', j.jobDescription ? `<p>${e(j.jobDescription)}</p>` : '')}
</body></html>`;
}

function openJobBrief(id) {
  const job = allJobs.find(j => j.id === id);
  if (!job) return;
  const url = URL.createObjectURL(new Blob([buildJobBrief(job)], { type: 'text/html' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function qaBank(excludeJobId) {
  const norm = t => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const current = new Set((allJobs.find(j => j.id === excludeJobId)?.interviewQA || []).map(x => norm(x.q)));
  const bank = new Map();
  for (const j of allJobs) {
    if (j.id === excludeJobId) continue;
    for (const item of j.interviewQA || []) {
      const key = norm(item.q);
      if (!key || current.has(key)) continue;
      const prev = bank.get(key);
      if (!prev) bank.set(key, { q: item.q, a: item.a || '', companies: [j.company] });
      else {
        if (!prev.companies.includes(j.company)) prev.companies.push(j.company);
        if (!prev.a && item.a) prev.a = item.a;
      }
    }
  }
  return [...bank.values()].sort((a, b) => b.companies.length - a.companies.length || a.q.localeCompare(b.q));
}

function renderQaBank(filter = '') {
  const el = document.getElementById('qaBankList');
  if (!el) return;
  const f = filter.trim().toLowerCase();
  const items = qaBank(qaCurrentJobId).filter(x => !f || `${x.q} ${x.a}`.toLowerCase().includes(f));
  el.innerHTML = items.length ? items.map((x, i) => `
    <div class="qa-item" style="display:flex;gap:8px;align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div class="qa-q-text">${escHtml(x.q)}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px">${escHtml(x.companies.join(', '))}${x.a ? ' · has answer' : ''}</div>
      </div>
      <button class="card-btn" data-qa-reuse="${i}" data-qa-reuse-q="${escHtml(x.q)}" title="Add to this job" style="font-size:11px;padding:2px 8px;flex-shrink:0">+ Add</button>
    </div>`).join('') : `<div style="color:#94a3b8;font-size:12px;text-align:center;padding:6px">${f ? 'No matching questions' : 'Nothing new to reuse'}</div>`;
  el.querySelectorAll('[data-qa-reuse]').forEach(btn => {
    btn.onclick = async () => {
      const item = qaBank(qaCurrentJobId).find(x => x.q === btn.dataset.qaReuseQ);
      if (!item) return;
      const job = allJobs.find(j => j.id === qaCurrentJobId);
      await send('UPDATE_JOB', { id: qaCurrentJobId, updates: { interviewQA: [...(job?.interviewQA || []), { q: item.q, a: item.a }] } });
      await reload();
      renderQaModal();
    };
  });
}

function renderQaModal() {
  const job = allJobs.find(j => j.id === qaCurrentJobId);
  const qa = job?.interviewQA || [];
  document.getElementById('qaModalBody').innerHTML = `
    ${qa.length ? qa.map((item, i) => `
      <div class="qa-item">
        <div class="qa-q-row">
          <span class="qa-num">Q${i + 1}</span>
          <span class="qa-q-text">${item.q}</span>
          ${item.a ? `<button class="qa-toggle-ans" data-qa-ans-id="${i}">▾ Answer</button>` : ''}
          <button class="card-btn danger" data-qa-del="${i}" style="font-size:10px;padding:2px 6px;flex-shrink:0">✕</button>
        </div>
        ${item.a ? `<div class="qa-ans" id="qaAns${i}" style="display:none">${item.a}</div>` : ''}
      </div>`).join('') : '<div style="color:#94a3b8;font-size:13px;margin-bottom:14px;text-align:center">No questions yet — add your first one below.</div>'}
    <div style="border-top:1px solid #e2e8f0;padding-top:14px;margin-top:${qa.length ? '4px' : '0'}">
      <label class="form-label">Question</label>
      <input id="qaNewQ" type="text" placeholder="e.g. Tell me about yourself…" maxlength="250"
        style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;margin-bottom:8px;box-sizing:border-box">
      <label class="form-label">Answer <span style="font-weight:400;color:#94a3b8">(optional)</span></label>
      <textarea id="qaNewA" rows="2" placeholder="Your planned answer or key points…" maxlength="600"
        style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;resize:vertical;box-sizing:border-box;margin-bottom:12px"></textarea>
      <button class="btn btn-primary" id="qaAddBtn" style="width:100%">+ Add Question</button>
    </div>
    ${qaBank(qaCurrentJobId).length ? `
    <details style="border-top:1px solid #e2e8f0;margin-top:14px;padding-top:12px">
      <summary style="cursor:pointer;font-size:13px;font-weight:600;color:#475569">📚 Reuse from other interviews (${qaBank(qaCurrentJobId).length})</summary>
      <input id="qaBankFilter" type="text" placeholder="Filter questions…"
        style="width:100%;padding:6px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:12px;outline:none;margin:10px 0 8px;box-sizing:border-box">
      <div id="qaBankList"></div>
    </details>` : ''}`;

  renderQaBank();
  const bankFilter = document.getElementById('qaBankFilter');
  if (bankFilter) bankFilter.oninput = () => renderQaBank(bankFilter.value);

  document.getElementById('qaAddBtn').onclick = async () => {
    const q = document.getElementById('qaNewQ').value.trim();
    if (!q) { document.getElementById('qaNewQ').focus(); return; }
    const a = document.getElementById('qaNewA').value.trim();
    const job = allJobs.find(j => j.id === qaCurrentJobId);
    const updated = [...(job?.interviewQA || []), { q, a }];
    await send('UPDATE_JOB', { id: qaCurrentJobId, updates: { interviewQA: updated } });
    await reload();
    renderQaModal();
  };

  document.querySelectorAll('[data-qa-del]').forEach(btn => {
    btn.onclick = async () => {
      const i = parseInt(btn.dataset.qaDel, 10);
      const job = allJobs.find(j => j.id === qaCurrentJobId);
      const updated = (job?.interviewQA || []).filter((_, idx) => idx !== i);
      await send('UPDATE_JOB', { id: qaCurrentJobId, updates: { interviewQA: updated } });
      await reload();
      renderQaModal();
    };
  });

  document.querySelectorAll('[data-qa-ans-id]').forEach(btn => {
    btn.onclick = () => {
      const ansEl = document.getElementById('qaAns' + btn.dataset.qaAnsId);
      if (!ansEl) return;
      const open = ansEl.style.display !== 'none';
      ansEl.style.display = open ? 'none' : 'block';
      btn.textContent = open ? '▾ Answer' : '▴ Answer';
    };
  });
}

function openTodosModal(jobId) {
  const job = allJobs.find(j => j.id === jobId);
  if (!job) return;
  todosJobId = jobId;
  document.getElementById('todosModalTitle').textContent = `${job.company} — Tasks`;
  renderTodosModal();
  document.getElementById('todosModal').style.display = 'flex';
  document.getElementById('todoNewInput').focus();
}

function closeTodosModal() {
  document.getElementById('todosModal').style.display = 'none';
  todosJobId = null;
}

function renderTodosModal() {
  const job   = allJobs.find(j => j.id === todosJobId);
  const todos = job?.todos || [];
  const done  = todos.filter(t => t.done).length;
  document.getElementById('todosModalBody').innerHTML = `
    ${todos.length ? `<div style="font-size:11px;color:#94a3b8;text-align:right;padding:0 12px 6px">${done}/${todos.length} done</div>` : ''}
    <div id="todoList">
      ${todos.length ? todos.map((t, i) => `
        <div class="todo-item">
          <input type="checkbox" class="todo-check" data-todo-toggle="${i}" ${t.done ? 'checked' : ''}>
          <span class="todo-text${t.done ? ' done' : ''}">${t.text.replace(/</g,'&lt;')}</span>
          <button class="card-btn danger" data-todo-del="${i}" style="font-size:10px;padding:2px 6px;flex-shrink:0">✕</button>
        </div>`).join('') : '<div style="color:#94a3b8;font-size:13px;padding:12px;text-align:center">No tasks yet — add one below.</div>'}
    </div>
    <div style="border-top:1px solid #e2e8f0;padding:14px 12px 0">
      <div style="display:flex;gap:8px">
        <input id="todoNewInput" type="text" placeholder="e.g. Send thank-you email…" maxlength="200"
          style="flex:1;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box">
        <button class="btn btn-primary" id="todoAddBtn" style="white-space:nowrap">+ Add</button>
      </div>
    </div>`;

  document.getElementById('todoAddBtn').onclick = async () => {
    const input = document.getElementById('todoNewInput');
    const text  = input.value.trim();
    if (!text) { input.focus(); return; }
    const job = allJobs.find(j => j.id === todosJobId);
    const updated = [...(job?.todos || []), { id: Date.now().toString(), text, done: false }];
    await send('UPDATE_JOB', { id: todosJobId, updates: { todos: updated } });
    await reload();
    renderTodosModal();
    document.getElementById('todoNewInput').focus();
  };

  document.getElementById('todoNewInput').onkeydown = e => {
    if (e.key === 'Enter') document.getElementById('todoAddBtn').click();
  };

  document.querySelectorAll('[data-todo-toggle]').forEach(cb => {
    cb.onchange = async () => {
      const i   = parseInt(cb.dataset.todoToggle, 10);
      const job = allJobs.find(j => j.id === todosJobId);
      const updated = (job?.todos || []).map((t, idx) => idx === i ? { ...t, done: cb.checked } : t);
      await send('UPDATE_JOB', { id: todosJobId, updates: { todos: updated } });
      await reload();
      renderTodosModal();
    };
  });

  document.querySelectorAll('[data-todo-del]').forEach(btn => {
    btn.onclick = async () => {
      const i   = parseInt(btn.dataset.todoDel, 10);
      const job = allJobs.find(j => j.id === todosJobId);
      const updated = (job?.todos || []).filter((_, idx) => idx !== i);
      await send('UPDATE_JOB', { id: todosJobId, updates: { todos: updated } });
      await reload();
      renderTodosModal();
    };
  });
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

async function duplicateJob(id) {
  const job = allJobs.find(j => j.id === id);
  if (!job) return;
  const dupe = {
    id: Date.now().toString(),
    title: job.title,
    company: job.company,
    url: job.url || '',
    status: 'applied',
    applicationMethod: job.applicationMethod || 'online',
    appliedDate: new Date().toISOString(),
    salary: job.salary || '',
    tags: [...(job.tags || [])],
    resumeVersion: job.resumeVersion || '',
    recruiterName: job.recruiterName || '',
    recruiterLinkedin: job.recruiterLinkedin || '',
    contactEmail: job.contactEmail || '',
    notes: job.notes || '',
    location: job.location || '',
    workType: job.workType || '',
    offerDetails: job.offerDetails || '',
    jobDescription: job.jobDescription || '',
    prepNotes: job.prepNotes || '',
    coverLetter: job.coverLetter || '',
    interviewDate: null,
    followupDate: null,
    deadline: null,
    events: [],
    interviewQA: [],
  };
  await send('ADD_JOB', { job: dupe });
  await reload();
  showToast(`Duplicated: ${job.title} @ ${job.company}`, 'success');
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
  document.getElementById('fSalary').value           = '';
  document.getElementById('fTags').value             = '';
  document.getElementById('fResume').value           = '';
  document.getElementById('fRecruiterName').value    = '';
  document.getElementById('fRecruiterLinkedin').value= '';
  document.getElementById('fEmail').value            = '';
  document.getElementById('fLocation').value    = '';
  document.getElementById('fWorkType').value    = '';
  document.getElementById('fNotes').value       = '';
  document.getElementById('fOfferDetails').value = '';
  document.getElementById('fFollowupDate').value = '';
  document.getElementById('fDeadline').value     = '';
  document.getElementById('fJobDesc').value     = '';
  document.getElementById('fPrep').value        = '';
  document.getElementById('fCoverLetter').value = '';
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
  document.getElementById('fSalary').value            = j.salary || '';
  document.getElementById('fTags').value              = (j.tags || []).join(', ');
  document.getElementById('fResume').value            = j.resumeVersion || '';
  document.getElementById('fRecruiterName').value     = j.recruiterName || '';
  document.getElementById('fRecruiterLinkedin').value = j.recruiterLinkedin || '';
  document.getElementById('fEmail').value             = j.contactEmail || '';
  document.getElementById('fLocation').value    = j.location || '';
  document.getElementById('fWorkType').value    = j.workType || '';
  document.getElementById('fNotes').value       = j.notes || '';
  document.getElementById('fOfferDetails').value = j.offerDetails || '';
  document.getElementById('fFollowupDate').value = j.followupDate ? j.followupDate.slice(0, 10) : '';
  document.getElementById('fDeadline').value     = j.deadline ? j.deadline.slice(0, 10) : '';
  document.getElementById('fJobDesc').value      = j.jobDescription || '';
  document.getElementById('fPrep').value         = j.prepNotes || '';
  document.getElementById('fCoverLetter').value  = j.coverLetter || '';
  document.getElementById('addModal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('addModal').style.display = 'none';
}

function openRoundModal(jobId) {
  document.getElementById('roundJobId').value = jobId;
  document.getElementById('roundType').value  = 'Phone Screen';
  document.getElementById('roundDate').value  = new Date().toISOString().split('T')[0];
  document.getElementById('roundNote').value  = '';
  document.getElementById('roundModal').style.display = 'flex';
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
    tags:              document.getElementById('fTags').value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean),
    resumeVersion:     document.getElementById('fResume').value.trim(),
    recruiterName:     document.getElementById('fRecruiterName').value.trim(),
    recruiterLinkedin: document.getElementById('fRecruiterLinkedin').value.trim(),
    contactEmail:      document.getElementById('fEmail').value.trim(),
    notes:        document.getElementById('fNotes').value.trim(),
    followupDate:   document.getElementById('fFollowupDate').value || null,
    deadline:       document.getElementById('fDeadline').value || null,
    location:       document.getElementById('fLocation').value.trim(),
    workType:       document.getElementById('fWorkType').value,
    offerDetails:   document.getElementById('fOfferDetails').value.trim(),
    jobDescription: document.getElementById('fJobDesc').value.trim(),
    prepNotes:      document.getElementById('fPrep').value.trim(),
    coverLetter:    document.getElementById('fCoverLetter').value.trim()
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
    } else {
      const prior = allJobs.filter(j => companyKey(j.company) === companyKey(data.company));
      if (prior.length) {
        const rejected = prior.filter(j => j.status === 'rejected').length;
        showToast(`Heads up: ${prior.length} earlier application${prior.length !== 1 ? 's' : ''} at ${data.company}${rejected ? ` (${rejected} rejected)` : ''}`, 'info');
      }
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
  followupMode  = 'followup';
  document.getElementById('followupModalTitle').textContent = 'Draft Follow-up Email';
  document.getElementById('followupKind').textContent = 'follow-up';

  document.getElementById('followupJobName').textContent = `${j.title} at ${j.company}`;
  document.getElementById('followupTo').value = j.contactEmail || '';

  const d     = daysSince(j.appliedDate);
  const draft = `Hi,\n\nI wanted to follow up on my application for the ${j.title} position that I submitted ${d} days ago.\n\nI'm still very interested in this role and would love the opportunity to discuss how my background could be a good fit for your team.\n\nPlease let me know if there's any additional information I can provide or if you'd like to schedule a time to connect.\n\nThank you for your time.\n\nBest regards`;

  document.getElementById('followupDraft').value = draft;
  document.getElementById('followupModal').style.display = 'flex';
}

function lastInterviewRound(j) {
  const round = (j.events || []).filter(e => e.type === 'round').pop();
  return round ? { type: (round.note || '').split(':')[0].trim(), date: round.date } : null;
}

function buildThankYouDraft(j) {
  const firstName = (j.recruiterName || '').trim().split(/\s+/)[0];
  const round = lastInterviewRound(j);
  const what  = round?.type ? `the ${round.type.toLowerCase()}` : 'our conversation';
  return `Hi${firstName ? ' ' + firstName : ''},\n\n` +
    `Thank you for taking the time to speak with me about the ${j.title} role at ${j.company}. I really enjoyed ${what} and learning more about the team and the work ahead.\n\n` +
    `Our discussion made me even more excited about the opportunity, and I'm confident my experience would let me contribute from day one.\n\n` +
    `Please don't hesitate to reach out if there's anything else I can share. I look forward to hearing about the next steps.\n\n` +
    `Best regards`;
}

// A rejection after interviewing is worth a feedback request; one straight
// from the application stage gets a shorter note.
function buildFeedbackDraft(j) {
  const firstName = (j.recruiterName || '').trim().split(/\s+/)[0];
  const interviewed = (j.events || []).some(e => ['interview', 'round'].includes(e.type)) || !!j.interviewDate;
  const round = lastInterviewRound(j);
  const stage = round?.type ? `the ${round.type.toLowerCase()} round` : interviewed ? 'the interviews' : 'my application';
  return `Hi${firstName ? ' ' + firstName : ''},\n\n` +
    `Thank you for letting me know about your decision on the ${j.title} role at ${j.company}. I appreciate the time the team put into ${interviewed ? 'meeting with me' : 'reviewing my application'}.\n\n` +
    `If you're able to share it, I'd really value any feedback on ${stage} — what stood out, and where I could have been stronger. It would help me a lot as I keep improving.\n\n` +
    `I'd be glad to be considered for future roles at ${j.company} that fit my background.\n\n` +
    `Best regards`;
}

function openFeedbackModal(jobId) {
  const j = allJobs.find(j => j.id === jobId);
  if (!j) return;
  followupJobId = jobId;
  followupMode  = 'feedback';
  document.getElementById('followupModalTitle').textContent = 'Ask for Feedback';
  document.getElementById('followupKind').textContent = 'feedback request';
  document.getElementById('followupJobName').textContent = `${j.title} at ${j.company}`;
  document.getElementById('followupTo').value = j.contactEmail || '';
  document.getElementById('followupDraft').value = buildFeedbackDraft(j);
  document.getElementById('followupModal').style.display = 'flex';
}

function openThankYouModal(jobId) {
  const j = allJobs.find(j => j.id === jobId);
  if (!j) return;
  followupJobId = jobId;
  followupMode  = 'thanks';
  document.getElementById('followupModalTitle').textContent = 'Draft Thank-you Note';
  document.getElementById('followupKind').textContent = 'thank-you note';
  document.getElementById('followupJobName').textContent = `${j.title} at ${j.company}`;
  document.getElementById('followupTo').value = j.contactEmail || '';
  document.getElementById('followupDraft').value = buildThankYouDraft(j);
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
  const subject = encodeURIComponent(
    followupMode === 'thanks'   ? `Thank you — ${j?.title || 'Interview'}` :
    followupMode === 'feedback' ? `Feedback request — ${j?.title || 'Application'}` :
                                  `Following Up — ${j?.title || 'Application'}`);
  window.open(`mailto:${to}?subject=${subject}&body=${body}`);
}

async function markFollowupSent() {
  if (followupJobId) {
    const now = new Date().toISOString();
    const updates = followupMode === 'thanks'   ? { thankYouSentAt: now }
                  : followupMode === 'feedback' ? { feedbackRequestedAt: now }
                  : { followUpSent: true };
    await send('UPDATE_JOB', { id: followupJobId, updates });
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
  renderInterviewSoon();
  if (viewMode === 'kanban') renderKanban(); else renderJobs();
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // Dark mode + export topbar buttons
  const savedTheme = localStorage.getItem('darkMode') || 'light';
  document.getElementById('darkModeBtn').textContent = savedTheme === 'dark' ? '☀️' : '🌙';
  document.getElementById('darkModeBtn').addEventListener('click', toggleDarkMode);

  // Color theme picker
  const pickerEl = document.getElementById('themePicker');
  const pickerBtn = document.getElementById('themePickerBtn');
  ACCENT_COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'theme-swatch';
    sw.dataset.hex = c.hex;
    sw.title = c.name;
    sw.style.background = c.hex;
    sw.style.color = c.hex;
    pickerEl.appendChild(sw);
  });
  applyAccentColor(localStorage.getItem('accentColor') || '#2563eb');
  pickerBtn.addEventListener('click', e => { e.stopPropagation(); pickerEl.classList.toggle('open'); });
  pickerEl.addEventListener('click', e => {
    const sw = e.target.closest('.theme-swatch');
    if (!sw) return;
    applyAccentColor(sw.dataset.hex);
    pickerEl.classList.remove('open');
  });
  document.addEventListener('click', e => {
    if (!pickerEl.contains(e.target) && e.target !== pickerBtn) pickerEl.classList.remove('open');
  });
  document.getElementById('calendarExportBtn').addEventListener('click', exportAllCalendar);
  document.getElementById('ghostSilentBtn').addEventListener('click', ghostSilentJobs);
  document.getElementById('checkPostingsBtn').addEventListener('click', checkAllPostings);
  document.getElementById('weeklyRecapBtn').addEventListener('click', copyWeeklyRecap);
  document.getElementById('duplicatesBtn').addEventListener('click', openDupesModal);
  document.getElementById('closeCompanyBtn').addEventListener('click', closeCompanyModal);
  document.getElementById('closeCompanyFooterBtn').addEventListener('click', closeCompanyModal);
  document.getElementById('companyModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeCompanyModal(); });
  document.getElementById('closeDupesBtn').addEventListener('click', closeDupesModal);
  document.getElementById('closeDupesFooterBtn').addEventListener('click', closeDupesModal);
  document.getElementById('dupesModal').addEventListener('click', async e => {
    if (e.target === e.currentTarget) { closeDupesModal(); return; }
    const groups = findDuplicateGroups(allJobs);
    const ignore = e.target.closest('[data-dupe-ignore]');
    if (ignore) {
      const g = groups[Number(ignore.dataset.dupeIgnore)];
      if (!g) return;
      const ids = g.map(j => j.id);
      for (const j of g) await send('UPDATE_JOB', { id: j.id, updates: { notDuplicateOf: [...new Set([...(j.notDuplicateOf || []), ...ids.filter(x => x !== j.id)])] } });
      await reload();
      renderDupesModal();
      return;
    }
    const merge = e.target.closest('[data-dupe-merge]');
    if (merge) {
      const g = groups[Number(merge.dataset.dupeMerge)];
      if (!g) return;
      const [primary, ...others] = g;
      const { id, ...updates } = mergeJobs(primary, others);
      await send('UPDATE_JOB', { id: primary.id, updates });
      for (const o of others) await send('DELETE_JOB', { id: o.id });
      await reload();
      renderDupesModal();
      showToast(`Merged ${g.length} applications into "${primary.title} — ${primary.company}"`, 'success');
    }
  });
  document.getElementById('backupJsonBtn').addEventListener('click', exportJson);
  document.getElementById('restoreJsonBtn').addEventListener('click', () => {
    document.getElementById('restoreJsonFile').value = '';
    document.getElementById('restoreJsonFile').click();
  });
  document.getElementById('restoreJsonFile').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) restoreJson(file);
    e.target.value = '';
  });

  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    const filtered = getFiltered();
    if (currentFilter !== 'all' && filtered.length < allJobs.length) {
      if (confirm(`Export ${filtered.length} visible job${filtered.length !== 1 ? 's' : ''} (current filter: "${currentFilter}")?\n\nCancel to export all ${allJobs.length} jobs instead.`)) {
        exportCsv(filtered);
      } else {
        exportCsv();
      }
    } else {
      exportCsv();
    }
  });

  // Import CSV
  document.getElementById('importCsvBtn').addEventListener('click', () => {
    document.getElementById('importCsvText').value = '';
    document.getElementById('importPreview').textContent = '';
    document.getElementById('importModal').style.display = 'flex';
  });
  const closeImport = () => { document.getElementById('importModal').style.display = 'none'; };
  document.getElementById('closeImportBtn').addEventListener('click', closeImport);
  document.getElementById('cancelImportBtn').addEventListener('click', closeImport);
  document.getElementById('importModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeImport(); });
  document.getElementById('importFile').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById('importCsvText').value = ev.target.result;
      const jobs = parseCsvToJobs(ev.target.result);
      document.getElementById('importPreview').textContent = `Found ${jobs.length} valid row${jobs.length !== 1 ? 's' : ''} to import.`;
    };
    reader.readAsText(file);
    e.target.value = '';
  });
  document.getElementById('importCsvText').addEventListener('input', e => {
    const jobs = parseCsvToJobs(e.target.value);
    document.getElementById('importPreview').textContent = jobs.length
      ? `Found ${jobs.length} valid row${jobs.length !== 1 ? 's' : ''} to import.`
      : '';
  });
  document.getElementById('confirmImportBtn').addEventListener('click', async () => {
    const text = document.getElementById('importCsvText').value;
    const jobs = parseCsvToJobs(text);
    if (!jobs.length) { showToast('No valid rows found. Check the format.', 'error'); return; }
    for (const job of jobs) await send('ADD_JOB', { job });
    closeImport();
    showToast(`Imported ${jobs.length} job${jobs.length !== 1 ? 's' : ''}`, 'success');
    await reload();
  });

  // Q&A modal
  document.getElementById('closeQaBtn').addEventListener('click', closeQaModal);
  document.getElementById('closeQaFooterBtn').addEventListener('click', closeQaModal);
  document.getElementById('qaModal').addEventListener('click', e => { if (e.target === document.getElementById('qaModal')) closeQaModal(); });
  document.getElementById('closeTodosBtn').addEventListener('click', closeTodosModal);
  document.getElementById('closeTodosFooterBtn').addEventListener('click', closeTodosModal);
  document.getElementById('todosModal').addEventListener('click', e => { if (e.target === document.getElementById('todosModal')) closeTodosModal(); });

  // Global search
  document.getElementById('globalSearchBtn').addEventListener('click', openGlobalSearch);
  document.getElementById('globalSearchModal').addEventListener('click', e => {
    if (e.target === document.getElementById('globalSearchModal')) closeGlobalSearch();
  });
  document.getElementById('globalSearchInput').addEventListener('input', e => renderGlobalResults(e.target.value));
  document.getElementById('globalSearchInput').addEventListener('keydown', e => { if (e.key === 'Escape') closeGlobalSearch(); });
  document.getElementById('globalSearchResults').addEventListener('click', e => {
    const row = e.target.closest('.gs-result');
    if (!row) return;
    closeGlobalSearch();
    if (row.dataset.gsType === 'tracker') {
      switchTab('tracker');
      currentSearch = row.dataset.gsCompany || '';
      document.getElementById('searchInput').value = currentSearch;
      if (viewMode === 'kanban') renderKanban(); else renderJobs();
    } else {
      switchTab('wishlist');
    }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openGlobalSearch(); }
  });

  // Topbar buttons
  document.getElementById('settingsNavBtn').addEventListener('click', () => {
    location.href = 'settings.html';
  });
  document.getElementById('addJobBtn').addEventListener('click', () => openAddModal());

  // Print button
  document.getElementById('printBtn').addEventListener('click', () => {
    const jobs = getFiltered();
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const label = currentFilter === 'all' ? 'All Applications' : currentFilter.charAt(0).toUpperCase() + currentFilter.slice(1);
    const CONF_LABELS = ['', '😬 Low', '😐 Uncertain', '🙂 Neutral', '😊 Hopeful', '🚀 Very confident'];
    document.getElementById('printView').innerHTML = `
      <h2>${label} (${jobs.length}) &nbsp;<span style="font-weight:400;color:#555">${date}</span></h2>
      <table>
        <thead><tr>
          <th>#</th><th>Company</th><th>Title</th><th>Status</th>
          <th>Applied</th><th>Method</th><th>Salary</th><th>Confidence</th><th>Notes</th>
        </tr></thead>
        <tbody>${jobs.map((j, i) => `<tr>
          <td>${i + 1}</td>
          <td>${j.company}</td>
          <td>${j.title}</td>
          <td>${j.status}${j.statusReason ? `<br><span style="color:#888;font-size:10px">${j.statusReason}</span>` : ''}</td>
          <td>${j.appliedDate ? new Date(j.appliedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</td>
          <td>${j.applicationMethod || ''}</td>
          <td>${j.salary || ''}</td>
          <td>${CONF_LABELS[j.confidence || 0] || ''}</td>
          <td class="pr-notes">${j.notes ? j.notes.slice(0, 100) + (j.notes.length > 100 ? '…' : '') : ''}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    window.print();
  });


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

  // Bulk tag
  async function applyBulkTag() {
    const raw = document.getElementById('bulkTagInput').value.trim().toLowerCase().replace(/\s+/g, '-');
    if (!raw) return;
    const ids = [...selectedIds];
    for (const id of ids) {
      const job = allJobs.find(j => j.id === id);
      if (!job) continue;
      const tags = [...new Set([...(job.tags || []), raw])];
      await send('UPDATE_JOB', { id, updates: { tags } });
    }
    document.getElementById('bulkTagInput').value = '';
    showToast(`Tag #${raw} added to ${ids.length} job${ids.length !== 1 ? 's' : ''}`, 'success');
    await reload();
  }
  document.getElementById('bulkTagBtn').addEventListener('click', applyBulkTag);
  document.getElementById('bulkTagInput').addEventListener('keydown', e => { if (e.key === 'Enter') applyBulkTag(); });
  document.getElementById('bulkStatusSelect').addEventListener('change', async e => {
    const status = e.target.value;
    if (!status) return;
    e.target.value = '';
    const ids = [...selectedIds];
    const snapshots = allJobs.filter(j => ids.includes(j.id) && j.status !== status).map(statusSnapshot);
    for (const id of ids) await send('UPDATE_JOB', { id, updates: { status, statusUpdated: new Date().toISOString(), archivedFrom: null } });
    clearSelection();
    showToast(`Marked ${ids.length} job${ids.length !== 1 ? 's' : ''} as "${status}"`, 'info',
      snapshots.length ? { label: 'Undo', onClick: () => restoreSnapshots(snapshots) } : {});
    await reload();
  });

  // Prep / JD toggles
  document.getElementById('jobsGrid').addEventListener('click', e => {
    const toggle = e.target.closest('.card-prep-toggle');
    if (!toggle) return;
    const prepId = toggle.dataset.prepId;
    const jdId   = toggle.dataset.jdId;
    const clId   = toggle.dataset.clId;
    const odId   = toggle.dataset.odId;
    const panel  = prepId ? document.getElementById(`prep-${prepId}`) : clId ? document.getElementById(`cl-${clId}`) : odId ? document.getElementById(`od-${odId}`) : document.getElementById(`jd-${jdId}`);
    if (!panel) return;
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    toggle.textContent = toggle.textContent.replace(open ? '▴' : '▾', open ? '▾' : '▴');
  });

  // Tag filter click
  document.getElementById('jobsGrid').addEventListener('click', e => {
    const tag = e.target.closest('.card-tag');
    if (!tag) return;
    const t = tag.dataset.tag;
    if (currentTagFilters.has(t)) currentTagFilters.delete(t);
    else currentTagFilters.add(t);
    renderJobs();
  });

  // Active tag chips: remove single tag or clear all
  document.getElementById('activeTagFilters').addEventListener('click', e => {
    if (e.target.dataset.clearTags !== undefined) { currentTagFilters.clear(); renderJobs(); return; }
    const t = e.target.dataset.removeTag;
    if (t) { currentTagFilters.delete(t); renderJobs(); }
  });

  // Color label filter bar
  document.getElementById('colorFilterBar').addEventListener('click', e => {
    if (e.target.dataset.clearColor !== undefined) { currentColorFilter = null; renderJobs(); return; }
    const c = e.target.dataset.colorFilter;
    if (c) { currentColorFilter = currentColorFilter === c ? null : c; renderJobs(); }
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
    const newPriority = job && job.priority === n ? 0 : n;
    await send('UPDATE_JOB', { id: jobId, updates: { priority: newPriority } });
    await reload();
  });

  // Interest hearts
  document.getElementById('jobsGrid').addEventListener('click', async e => {
    const heart = e.target.closest('.iheart');
    if (!heart) return;
    const wrap  = heart.closest('.interest-hearts');
    const jobId = wrap?.dataset.jobId;
    if (!jobId) return;
    const n = parseInt(heart.dataset.heart, 10);
    const job = allJobs.find(j => j.id === jobId);
    const newInterest = job && job.interest === n ? 0 : n;
    await send('UPDATE_JOB', { id: jobId, updates: { interest: newInterest } });
    await reload();
  });

  // Confidence emojis
  document.getElementById('jobsGrid').addEventListener('click', async e => {
    const emoji = e.target.closest('.cemoji');
    if (!emoji) return;
    const wrap = emoji.closest('.conf-emojis');
    const jobId = wrap?.dataset.jobId;
    if (!jobId) return;
    const n = parseInt(emoji.dataset.conf, 10);
    const job = allJobs.find(j => j.id === jobId);
    const newConf = job && job.confidence === n ? 0 : n;
    await send('UPDATE_JOB', { id: jobId, updates: { confidence: newConf } });
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
    if (e.target.closest('.pstar'))   return;
    if (e.target.closest('.iheart'))  return;
    if (e.target.closest('.cemoji'))  return;
    if (e.target.closest('[data-action="cycle-label"]')) {
      const dot = e.target.closest('[data-action="cycle-label"]');
      const jid = dot.dataset.jobId;
      const job = allJobs.find(j => j.id === jid);
      if (!job) return;
      const idx  = LABEL_COLORS.indexOf(job.colorLabel ?? null);
      const next = LABEL_COLORS[(idx + 1) % LABEL_COLORS.length];
      send('UPDATE_JOB', { id: jid, updates: { colorLabel: next } }).then(reload);
      return;
    }
    if (e.target.closest('.quick-note-submit')) return;
    if (e.target.closest('.card-prep-toggle')) return;
    if (e.target.closest('.card-tag')) return;
    const btn   = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const jobId  = btn.dataset.jobId || btn.closest('[data-job-id]')?.dataset.jobId;
    if (action === 'qa')            openQaModal(jobId);
    if (action === 'todos')         openTodosModal(jobId);
    if (action === 'edit')          editJob(jobId);
    if (action === 'delete')        deleteJob(jobId);
    if (action === 'followup')      openFollowupModal(jobId);
    if (action === 'thank-you')     openThankYouModal(jobId);
    if (action === 'feedback')      openFeedbackModal(jobId);
    if (action === 'brief')         openJobBrief(jobId);
    if (action === 'company')       openCompanyModal(jobId);
    if (action === 'add-round')     openRoundModal(jobId);
    if (action === 'duplicate')       duplicateJob(jobId);
    if (action === 'toggle-pin') {
      const job = allJobs.find(j => j.id === jobId);
      if (job) send('UPDATE_JOB', { id: jobId, updates: { pinned: !job.pinned } }).then(reload);
    }
    if (action === 'company-history') {
      const job = allJobs.find(j => j.id === jobId);
      if (job) {
        currentSearch = job.company;
        document.getElementById('searchInput').value = job.company;
        renderJobs();
      }
    }
    if (action === 'check-posting') {
      btn.disabled = true;
      checkJobPosting(jobId).then(async r => {
        await reload();
        const msg = !r ? 'Could not check posting.'
          : r.state === 'closed'  ? `Posting looks closed (${r.reason})`
          : r.state === 'open'    ? 'Posting still looks open'
          : `Couldn't tell — ${r.reason}`;
        showToast(msg, r?.state === 'open' ? 'success' : r?.state === 'closed' ? 'error' : 'info');
      });
    }
    if (action === 'unsnooze') {
      send('UPDATE_JOB', { id: jobId, updates: { snoozedUntil: null } }).then(reload);
    }
    if (action === 'archive-stale')  quickStatus(jobId, 'archived');
    if (action === 'calendar') {
      const job = allJobs.find(j => j.id === jobId);
      if (job) downloadIcs(jobCalendarEvents(job), `${(job.company || 'job').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`);
    }
    if (action === 'clear-followup') {
      send('UPDATE_JOB', { id: jobId, updates: { followupDate: null } }).then(reload);
    }
    if (action === 'copy') {
      const job = allJobs.find(j => j.id === jobId);
      if (job) {
        const lines = [
          `${job.title} — ${job.company}`,
          `Status: ${job.status}  |  Applied: ${fmtDate(job.appliedDate)}`,
          job.salary       ? `Salary: ${job.salary}` : null,
          job.url          ? `Posting: ${job.url}` : null,
          job.recruiterName ? `Recruiter: ${job.recruiterName}${job.recruiterLinkedin ? ' — ' + job.recruiterLinkedin : ''}` : null,
          job.contactEmail  ? `Email: ${job.contactEmail}` : null,
          job.resumeVersion ? `Resume: ${job.resumeVersion}` : null,
          job.interviewDate ? `Interview date: ${fmtDate(job.interviewDate)}` : null,
          '',
          job.jobDescription ? `JOB DESCRIPTION\n${job.jobDescription}` : null,
          job.notes         ? `NOTES\n${job.notes}` : null,
          job.prepNotes     ? `INTERVIEW PREP\n${job.prepNotes}` : null,
          (job.tags && job.tags.length) ? `Tags: ${job.tags.map(t => '#'+t).join(' ')}` : null,
        ].filter(l => l !== null).join('\n');
        navigator.clipboard.writeText(lines).then(() => showToast('Job summary copied to clipboard!', 'success'));
      }
    }
  });

  // Job grid: status select delegation
  document.getElementById('jobsGrid').addEventListener('change', e => {
    const snoozeSel = e.target.closest('[data-action="snooze"]');
    if (snoozeSel) {
      if (snoozeSel.value) snoozeJob(snoozeSel.dataset.jobId, Number(snoozeSel.value));
      return;
    }
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
  document.getElementById('savedViewsBar').addEventListener('click', e => {
    if (e.target.closest('#saveViewBtn')) { saveCurrentView(); return; }
    const remove = e.target.closest('[data-remove-view]');
    if (remove) {
      const views = loadSavedViews();
      const [gone] = views.splice(Number(remove.dataset.removeView), 1);
      storeSavedViews(views);
      renderSavedViews();
      if (gone) showToast(`Deleted view "${gone.name}"`, 'info');
      return;
    }
    const chip = e.target.closest('[data-view-idx]');
    if (chip) applySavedView(Number(chip.dataset.viewIdx));
  });
  document.getElementById('trackerSort').addEventListener('change', e => {
    trackerSort = e.target.value;
    if (viewMode === 'kanban') renderKanban(); else renderJobs();
  });

  document.getElementById('workTypeFilter').addEventListener('change', e => {
    currentWorkTypeFilter = e.target.value;
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
  document.getElementById('tabTracker').addEventListener('click',  () => switchTab('tracker'));
  document.getElementById('tabFinder').addEventListener('click',   () => switchTab('finder'));
  document.getElementById('tabWishlist').addEventListener('click', () => switchTab('wishlist'));
  document.getElementById('tabNotes').addEventListener('click',    () => switchTab('notes'));
  document.getElementById('tabContacts').addEventListener('click', () => switchTab('contacts'));
  document.getElementById('contactsSearch').addEventListener('input', renderContacts);
  document.getElementById('contactsCopyEmailsBtn').addEventListener('click', () => {
    const emails = [...new Set(filteredContacts().map(c => c.email).filter(Boolean))];
    if (!emails.length) { showToast('No email addresses to copy.', 'error'); return; }
    navigator.clipboard.writeText(emails.join(', ')).then(() => showToast(`Copied ${emails.length} email${emails.length !== 1 ? 's' : ''}`, 'success'));
  });
  document.getElementById('contactsList').addEventListener('click', e => {
    const copy = e.target.closest('[data-copy-email]');
    if (copy) {
      navigator.clipboard.writeText(copy.dataset.copyEmail).then(() => showToast('Email copied', 'success'));
      return;
    }
    const job = e.target.closest('[data-contact-company]');
    if (job) {
      switchTab('tracker');
      setFilter('all', document.querySelector('.filter-tab[data-filter="all"]'));
      currentSearch = job.dataset.contactCompany;
      document.getElementById('searchInput').value = currentSearch;
      if (viewMode === 'kanban') renderKanban(); else renderJobs();
    }
  });
  document.getElementById('notesArea').addEventListener('input', scheduleNotesSave);

  // Wishlist modal
  document.getElementById('addWishlistBtn').addEventListener('click', openWishlistModal);
  document.getElementById('closeWishlistModalBtn').addEventListener('click',  () => { document.getElementById('wishlistModal').style.display = 'none'; });
  document.getElementById('cancelWishlistModalBtn').addEventListener('click', () => { document.getElementById('wishlistModal').style.display = 'none'; });
  document.getElementById('saveWishlistBtn').addEventListener('click', async () => {
    const company = document.getElementById('wCompany').value.trim();
    if (!company) { document.getElementById('wCompany').focus(); return; }
    await send('ADD_WISHLIST', { item: {
      company,
      title: document.getElementById('wTitle').value.trim(),
      url:   document.getElementById('wUrl').value.trim(),
      notes: document.getElementById('wNotes').value.trim(),
    }});
    document.getElementById('wishlistModal').style.display = 'none';
    renderWishlist();
  });

  document.getElementById('reapplyList').addEventListener('click', async e => {
    const companyLink = e.target.closest('[data-wl-company]');
    if (companyLink) { e.preventDefault(); openCompanyModal(companyLink.dataset.wlCompany); return; }
    const addBtn = e.target.closest('[data-reapply-add]');
    if (!addBtn) return;
    const j = allJobs.find(x => x.id === addBtn.dataset.reapplyAdd);
    if (!j) return;
    await send('ADD_WISHLIST', { item: { company: j.company, title: j.title || '', url: '', notes: `Reapplying — previously ${j.archivedFrom || j.status} for ${j.title}` } });
    showToast(`${j.company} added to wishlist`, 'success');
    renderWishlist();
  });

  document.getElementById('interviewSoonSection').addEventListener('click', e => {
    const btn = e.target.closest('[data-soon]');
    if (!btn) return;
    const id = btn.dataset.jobId;
    ({ brief: openJobBrief, qa: openQaModal, company: openCompanyModal, edit: editJob })[btn.dataset.soon]?.(id);
  });

  // Wishlist grid click delegation
  document.getElementById('wishlistGrid').addEventListener('click', async e => {
    const delBtn   = e.target.closest('[data-wl-delete]');
    const startBtn = e.target.closest('[data-wl-start]');
    const companyLink = e.target.closest('[data-wl-company]');
    if (companyLink) {
      e.preventDefault();
      openCompanyModal(companyLink.dataset.wlCompany);
      return;
    }
    if (delBtn) {
      const id = delBtn.dataset.wlDelete;
      await send('DELETE_WISHLIST', { id });
      renderWishlist();
    }
    if (startBtn) {
      const id = startBtn.dataset.wlStart;
      const { items } = await send('GET_WISHLIST', {});
      const item = items.find(i => i.id === id);
      if (!item) return;
      document.getElementById('fCompany').value = item.company;
      document.getElementById('fTitle').value   = item.title || '';
      document.getElementById('fUrl').value     = item.url   || '';
      document.getElementById('fNotes').value   = item.notes || '';
      document.getElementById('fStatus').value  = 'applied';
      document.getElementById('fDate').value    = new Date().toISOString().slice(0, 10);
      // clear remaining fields
      ['fSalary','fResume','fTags','fEmail','fPrep','fJobDesc','fFollowupDate','fDeadline','fMethod','fInterviewDate','fRecruiterName','fRecruiterLinkedin'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      editingId = null;
      document.getElementById('modalTitle').textContent = 'Add Application';
      document.getElementById('addModal').style.display = 'flex';
      await send('DELETE_WISHLIST', { id });
      switchTab('tracker');
    }
  });

  // Weekly goal input
  document.getElementById('goalInput').addEventListener('change', e => {
    const v = Math.max(1, parseInt(e.target.value, 10) || 5);
    e.target.value = v;
    localStorage.setItem('weeklyGoal', v);
    renderGoal();
  });

  // Monthly goal input
  document.getElementById('monthGoalInput')?.addEventListener('change', e => {
    const v = Math.max(1, parseInt(e.target.value, 10) || 20);
    e.target.value = v;
    localStorage.setItem('monthlyGoal', v);
    renderGoal();
  });

  // Stats tab
  document.getElementById('tabStats').addEventListener('click', () => switchTab('stats'));

  // KPI cards in Stats tab → jump to tracker filtered
  document.getElementById('statsPanel').addEventListener('click', e => {
    const card = e.target.closest('.kpi-clickable[data-kpi-filter]');
    if (!card) return;
    const f = card.dataset.kpiFilter;
    switchTab('tracker');
    setFilter(f, document.querySelector(`.stat-card[data-filter="${f}"], .filter-tab[data-filter="${f}"]`));
  });

  // Finder view toggle (Jobs / LinkedIn Posts / Saved)
  document.getElementById('finderViewJobs').addEventListener('click',   () => setFinderView('jobs'));
  document.getElementById('finderViewPosts').addEventListener('click',  () => setFinderView('posts'));
  document.getElementById('finderViewSaved').addEventListener('click',  () => setFinderView('saved'));
  document.getElementById('finderViewHidden').addEventListener('click', () => setFinderView('hidden'));

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

    // Finder note save
    const noteSaveBtn = e.target.closest('[data-finder-note-save]');
    if (noteSaveBtn) {
      const id = noteSaveBtn.dataset.finderNoteSave;
      const input = document.querySelector(`[data-finder-note="${id}"]`);
      const note = input?.value.trim() || '';
      if (note) finderNotes[id] = note; else delete finderNotes[id];
      localStorage.setItem('finderNotes', JSON.stringify(finderNotes));
      showToast('Note saved', 'success');
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
      || document.getElementById('followupModal').style.display !== 'none'
      || document.getElementById('shortcutsModal').style.display !== 'none';

    switch (e.key) {
      case '1': switchTab('tracker');  break;
      case '2': switchTab('finder');   break;
      case '3': switchTab('stats');    break;
      case '4': switchTab('wishlist'); break;
      case '5': switchTab('notes');   break;
      case 'a': if (!modalOpen) openAddModal(); break;
      case '/':
        e.preventDefault();
        if (!modalOpen) {
          const activeTab = document.getElementById('tabFinder').classList.contains('active');
          if (activeTab) document.getElementById('finderSearch')?.focus();
          else           document.getElementById('searchInput')?.focus();
        }
        break;
      case '?':
        document.getElementById('shortcutsModal').style.display = 'flex';
        break;
      case 'Escape':
        closeModal();
        closeFollowupModal();
        document.getElementById('shortcutsModal').style.display = 'none';
        break;
    }
  });

  document.getElementById('closeShortcutsBtn').addEventListener('click', () => {
    document.getElementById('shortcutsModal').style.display = 'none';
  });
  document.getElementById('shortcutsModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });

  // Interview round modal
  const closeRound = () => { document.getElementById('roundModal').style.display = 'none'; };
  document.getElementById('closeRoundBtn').addEventListener('click', closeRound);
  document.getElementById('cancelRoundBtn').addEventListener('click', closeRound);
  document.getElementById('roundModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeRound(); });
  document.getElementById('saveRoundBtn').addEventListener('click', async () => {
    const jobId = document.getElementById('roundJobId').value;
    const type  = document.getElementById('roundType').value;
    const date  = document.getElementById('roundDate').value;
    const note  = document.getElementById('roundNote').value.trim();
    if (!date) { showToast('Please pick a date.', 'error'); return; }
    const eventDate = new Date(date).toISOString();
    const label = note ? `${type}: ${note}` : type;
    await send('UPDATE_JOB', { id: jobId, updates: { _note: label, status: allJobs.find(j => j.id === jobId)?.status } });
    // Patch the event type to 'round' so it gets the purple dot
    const jobs = await send('GET_JOBS', {});
    const job = jobs && jobs.find ? jobs.find(j => j.id === jobId) : null;
    if (job && job.events) {
      const last = job.events[job.events.length - 1];
      if (last && last.note === label) {
        last.type = 'round';
        last.date = eventDate;
        await send('UPDATE_JOB', { id: jobId, updates: { events: job.events } });
      }
    }
    closeRound();
    showToast(`Round logged: ${type}`, 'success');
    await reload();
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
  document.getElementById('tabTracker').classList.toggle('active',  tab === 'tracker');
  document.getElementById('tabFinder').classList.toggle('active',   tab === 'finder');
  document.getElementById('tabStats').classList.toggle('active',    tab === 'stats');
  document.getElementById('tabWishlist').classList.toggle('active', tab === 'wishlist');
  document.getElementById('tabNotes').classList.toggle('active',    tab === 'notes');
  document.getElementById('tabContacts').classList.toggle('active', tab === 'contacts');
  document.getElementById('trackerPanel').style.display   = tab === 'tracker'  ? '' : 'none';
  document.getElementById('trackerSearch').style.display  = tab === 'tracker'  ? '' : 'none';
  document.getElementById('finderPanel').style.display    = tab === 'finder'   ? '' : 'none';
  document.getElementById('statsPanel').style.display     = tab === 'stats'    ? '' : 'none';
  document.getElementById('wishlistPanel').style.display  = tab === 'wishlist' ? '' : 'none';
  document.getElementById('notesPanel').style.display     = tab === 'notes'    ? '' : 'none';
  document.getElementById('contactsPanel').style.display  = tab === 'contacts' ? '' : 'none';
  if (tab !== 'tracker') clearSelection();
  if (tab === 'finder')   loadFinderJobs();
  if (tab === 'stats')    renderAnalytics();
  if (tab === 'wishlist') renderWishlist();
  if (tab === 'notes')    loadNotes();
  if (tab === 'contacts') renderContacts();
}

async function loadNotes() {
  const r = await chrome.storage.local.get('journalNotes');
  const area = document.getElementById('notesArea');
  if (area) area.value = r.journalNotes || '';
}

let notesSaveTimer = null;
function scheduleNotesSave() {
  clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(async () => {
    const text = document.getElementById('notesArea').value;
    await chrome.storage.local.set({ journalNotes: text });
    const lbl = document.getElementById('notesSavedLabel');
    if (lbl) { lbl.textContent = 'Saved ✓'; setTimeout(() => { lbl.textContent = ''; }, 2000); }
  }, 800);
}

// ── Wishlist ─────────────────────────────────────────────────────────────────

// Companies where every tracked application was rejected or ghosted at least
// `months` ago, and that are not already on the wishlist.
function reapplyCandidates(jobs, wishlist, months, now = Date.now()) {
  if (!months) return [];
  const cutoff = now - months * 30.44 * 86400000;
  const onWishlist = new Set((wishlist || []).map(i => companyKey(i.company)));
  const out = [];
  for (const [key, group] of groupByCompany(jobs)) {
    if (onWishlist.has(key)) continue;
    let lastClosed = 0, interviewed = false;
    const closed = group.every(j => {
      const status = j.status === 'archived' ? j.archivedFrom : j.status;
      if (!['rejected', 'ghosted'].includes(status)) return false;
      const ev = (j.events || []).filter(e => e.type === status).pop();
      lastClosed = Math.max(lastClosed, new Date(j.statusUpdated || ev?.date || j.appliedDate).getTime() || 0);
      if ((j.events || []).some(e => ['interview', 'round'].includes(e.type))) interviewed = true;
      return true;
    });
    if (!closed || !lastClosed || lastClosed > cutoff) continue;
    const latest = group.slice().sort((a, b) => new Date(b.appliedDate) - new Date(a.appliedDate))[0];
    out.push({ key, company: latest.company, latest, count: group.length, lastClosed, interviewed });
  }
  // companies where I got further are better bets
  return out.sort((a, b) => (b.interviewed - a.interviewed) || (a.lastClosed - b.lastClosed));
}

function renderReapply(items) {
  const months = settings.reapplyAfterMonths ?? 6;
  const list = reapplyCandidates(allJobs, items, months);
  const sec = document.getElementById('reapplySection');
  if (!list.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  document.getElementById('reapplyHint').textContent =
    `Every application to these companies closed over ${months} months ago — worth another look. Change the wait in Settings.`;
  document.getElementById('reapplyList').innerHTML = list.slice(0, 8).map(c => `
    <div style="display:flex;align-items:center;gap:10px;font-size:13px">
      <a href="#" data-wl-company="${c.latest.id}" style="font-weight:600;color:inherit;text-decoration:none">${escHtml(c.company)}</a>
      <span style="color:#94a3b8;font-size:12px">${c.count > 1 ? `${c.count} applications · ` : ''}last ${escHtml(c.latest.title)} · closed ${fmtDate(new Date(c.lastClosed).toISOString())}${c.interviewed ? ' · reached interview' : ''}</span>
      <button class="card-btn" style="margin-left:auto" data-reapply-add="${c.latest.id}">⭐ Add to wishlist</button>
    </div>`).join('') +
    (list.length > 8 ? `<div style="font-size:12px;color:#94a3b8">+ ${list.length - 8} more</div>` : '');
}

async function renderWishlist() {
  const { items } = await send('GET_WISHLIST', {});
  const grid = document.getElementById('wishlistGrid');
  if (!allJobs.length) allJobs = (await send('GET_JOBS'))?.jobs || [];
  renderReapply(items);
  if (!items || !items.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="es-icon">⭐</div><div class="es-text">No targets yet</div><div class="es-sub">Add companies you want to apply to — click "+ Add Target" to get started</div></div>`;
    return;
  }
  const byCompany = groupByCompany(allJobs);
  const staleDays = 21;
  grid.innerHTML = items.map(item => {
    const tracked = (byCompany.get(companyKey(item.company)) || [])
      .slice().sort((a, b) => new Date(b.appliedDate) - new Date(a.appliedDate));
    const latest = tracked[0];
    const age = daysSince(item.addedAt);
    const appliedBadge = latest ? `
          <div class="meta-item"><a href="#" data-wl-company="${latest.id}" style="color:#7c3aed;font-weight:600;text-decoration:none"
            title="${tracked.map(j => `${escHtml(j.title)} (${j.status})`).join(' · ')}">📋 Already applied here${tracked.length > 1 ? ` ${tracked.length}×` : ''} · ${latest.status}</a></div>` : '';
    const staleBadge = !latest && age >= staleDays
      ? `<div class="meta-item" style="color:#d97706;font-weight:600" title="Apply or remove it to keep the list short">⏳ On the list ${age} days — still interested?</div>` : '';
    return `
    <div class="job-card" style="position:relative">
      <div class="card-header">
        <div class="card-avatar" style="${avatarStyle(item.company)}">${initials(item.company)}</div>
        <div class="card-main">
          <div class="card-title">${item.company}</div>
          <div class="card-company">${item.title || 'Role not specified'}</div>
        </div>
        <button class="card-btn danger" style="align-self:flex-start" data-wl-delete="${item.id}" title="Remove">✕</button>
      </div>
      <div class="card-body">
        <div class="card-meta">
          ${item.url ? `<div class="meta-item"><a href="${item.url}" target="_blank" style="color:#2563eb;text-decoration:none">🔗 View Posting</a></div>` : ''}
          <div class="meta-item" style="color:#94a3b8;font-size:11px">Added ${fmtDate(item.addedAt)}</div>
          ${appliedBadge}${staleBadge}
        </div>
        ${item.notes ? `<div class="card-notes">${item.notes}</div>` : ''}
      </div>
      <div class="card-actions">
        <button class="card-btn accent" data-wl-start="${item.id}" style="background:#2563eb;color:#fff;border:none">▶ Start Application</button>
        <a class="card-btn" href="https://www.glassdoor.com/Search/results.htm?keyword=${encodeURIComponent(item.company)}" target="_blank" style="text-decoration:none;display:flex;align-items:center;justify-content:center" title="Glassdoor">🌟</a>
        <a class="card-btn" href="https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(item.company)}" target="_blank" style="text-decoration:none;display:flex;align-items:center;justify-content:center" title="LinkedIn">🔗</a>
        <a class="card-btn" href="https://www.levels.fyi/companies/${encodeURIComponent(item.company.toLowerCase().replace(/\s+/g,'-'))}/salaries/" target="_blank" style="text-decoration:none;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700" title="Levels.fyi">💲</a>
      </div>
    </div>`;
  }).join('');
}

function openWishlistModal() {
  document.getElementById('wCompany').value = '';
  document.getElementById('wTitle').value   = '';
  document.getElementById('wUrl').value     = '';
  document.getElementById('wNotes').value   = '';
  document.getElementById('wishlistModal').style.display = 'flex';
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
  document.getElementById('finderViewJobs').classList.toggle('active',   mode === 'jobs');
  document.getElementById('finderViewPosts').classList.toggle('active',  mode === 'posts');
  document.getElementById('finderViewSaved').classList.toggle('active',  mode === 'saved');
  document.getElementById('finderViewHidden').classList.toggle('active', mode === 'hidden');
  document.getElementById('finderHeading').textContent =
    mode === 'posts'  ? 'LinkedIn Hiring Posts — Golang Opportunities' :
    mode === 'saved'  ? '⭐ Saved Jobs' :
    mode === 'hidden' ? `🚫 Hidden Jobs (${hiddenFinderIds.size})` :
    'Job Suggestions — Scored for Your Profile';
  const filterRow = document.getElementById('finderFilterRow');
  if (filterRow) filterRow.style.display = mode === 'jobs' ? '' : 'none';
  renderFinderJobs();
}

function renderFinderJobs() {
  const grid = document.getElementById('finderGrid');

  if (finderView === 'hidden') {
    const hiddenJobs = finderJobs.filter(j => hiddenFinderIds.has(j.id));
    if (!hiddenJobs.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="es-icon">🚫</div><div class="es-text">No hidden jobs</div><div class="es-sub">Jobs you dismiss won't appear here until you hide some</div></div>`;
      return;
    }
    grid.innerHTML = hiddenJobs.map(j => `
      <div class="finder-card" style="opacity:0.75">
        <div class="fc-header">
          <div class="fc-avatar" style="${avatarStyle(j.company)}">${initials(j.company)}</div>
          <div class="fc-main">
            <div class="fc-title">${j.title}</div>
            <div class="fc-company">${j.company}${j.location ? ` · ${j.location}` : ''}</div>
          </div>
        </div>
        <div class="fc-actions">
          <button class="card-btn" style="background:#2563eb;color:#fff;border:none" data-unhide="${j.id}">↩ Unhide</button>
        </div>
      </div>`).join('');

    grid.querySelectorAll('[data-unhide]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.unhide;
        hiddenFinderIds.delete(id);
        localStorage.setItem('hiddenFinderIds', JSON.stringify([...hiddenFinderIds]));
        setFinderView('hidden');
      });
    });
    return;
  }

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
            ${j.salary ? salaryMeta(j) : ''}
            ${foundLabel ? `<div class="meta-item">🗓 ${foundLabel}</div>` : ''}
            ${j.postedAt ? `<div class="meta-item">📅 Posted: ${j.postedAt}</div>` : ''}
          </div>
          ${chips ? `<div class="skill-chips">${chips}</div>` : ''}
          ${j.description ? `<div class="card-notes">${j.description}</div>` : ''}
          ${saved && finderView === 'saved' ? `
          <div style="margin-top:8px">
            ${finderNotes[j.id] ? `<div style="font-size:12px;color:#64748b;font-style:italic;margin-bottom:6px;padding:6px 10px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0">📝 ${finderNotes[j.id]}</div>` : ''}
            <div style="display:flex;gap:6px">
              <input class="quick-note-input" data-finder-note="${j.id}" placeholder="📝 Add a note about this job…"
                value="${(finderNotes[j.id] || '').replace(/"/g, '&quot;')}" style="font-size:12px">
              <button class="quick-note-submit" data-finder-note-save="${j.id}" title="Save note">✓</button>
            </div>
          </div>` : ''}
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

  // Count applications this current week (Sun–Sat) and last week
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const lastWeekStart = new Date(weekStart); lastWeekStart.setDate(weekStart.getDate() - 7);
  const thisWeek = allJobs.filter(j => j.appliedDate && new Date(j.appliedDate) >= weekStart).length;
  const lastWeek = allJobs.filter(j => {
    if (!j.appliedDate) return false;
    const d = new Date(j.appliedDate);
    return d >= lastWeekStart && d < weekStart;
  }).length;
  const diff = thisWeek - lastWeek;
  const trend = lastWeek === 0 ? '' : diff > 0 ? ` ↑${diff}` : diff < 0 ? ` ↓${Math.abs(diff)}` : ' →';
  const trendColor = diff > 0 ? '#16a34a' : diff < 0 ? '#dc2626' : '#64748b';

  const pct = Math.min(100, Math.round(thisWeek / goal * 100));
  const bar = document.getElementById('goalBar');
  const label = document.getElementById('goalLabel');
  const trendEl = document.getElementById('goalTrend');
  if (bar)     bar.style.width = pct + '%';
  if (bar)     bar.style.background = pct >= 100 ? '#16a34a' : pct >= 60 ? '#2563eb' : '#f97316';
  if (label)   label.textContent = `${thisWeek} / ${goal} this week${pct >= 100 ? ' 🎉' : ''}`;
  if (trendEl) { trendEl.textContent = trend; trendEl.style.color = trendColor; }

  // Monthly goal
  const monthGoal = parseInt(localStorage.getItem('monthlyGoal') || '20', 10);
  const monthInput = document.getElementById('monthGoalInput');
  if (monthInput) monthInput.value = monthGoal;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonth = allJobs.filter(j => j.appliedDate && new Date(j.appliedDate) >= monthStart).length;
  const lastMonth = allJobs.filter(j => {
    if (!j.appliedDate) return false;
    const d = new Date(j.appliedDate);
    return d >= lastMonthStart && d < monthStart;
  }).length;
  const monthDiff = thisMonth - lastMonth;
  const monthTrend = lastMonth === 0 ? '' : monthDiff > 0 ? ` ↑${monthDiff}` : monthDiff < 0 ? ` ↓${Math.abs(monthDiff)}` : ' →';
  const monthTrendColor = monthDiff > 0 ? '#16a34a' : monthDiff < 0 ? '#dc2626' : '#64748b';
  const monthPct = Math.min(100, Math.round(thisMonth / monthGoal * 100));
  const monthBar = document.getElementById('monthGoalBar');
  const monthLabel = document.getElementById('monthGoalLabel');
  const monthTrendEl = document.getElementById('monthGoalTrend');
  const monthName = now.toLocaleDateString('en-US', { month: 'long' });
  if (monthBar)     { monthBar.style.width = monthPct + '%'; monthBar.style.background = monthPct >= 100 ? '#16a34a' : monthPct >= 60 ? '#2563eb' : '#f97316'; }
  if (monthLabel)   monthLabel.textContent = `${thisMonth} / ${monthGoal} in ${monthName}${monthPct >= 100 ? ' 🎉' : ''}`;
  if (monthTrendEl) { monthTrendEl.textContent = monthTrend; monthTrendEl.style.color = monthTrendColor; }
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

function parseSalary(s) {
  if (!s) return null;
  const clean = s.replace(/[,\s]/g, '').toLowerCase();
  // range: "50k-70k", "50000-70000", "$50k-$80k"
  const range = clean.match(/\$?(\d+(?:\.\d+)?)(k?)-\$?(\d+(?:\.\d+)?)(k?)/);
  if (range) {
    let lo = parseFloat(range[1]) * (range[2] === 'k' ? 1000 : 1);
    let hi = parseFloat(range[3]) * (range[4] === 'k' ? 1000 : 1);
    if (lo < 1000) lo *= 1000;
    if (hi < 1000) hi *= 1000;
    return (lo + hi) / 2;
  }
  // single: "50k", "$80000", "120k"
  const single = clean.match(/\$?(\d+(?:\.\d+)?)(k?)/);
  if (!single) return null;
  let v = parseFloat(single[1]) * (single[2] === 'k' ? 1000 : 1);
  if (v < 1000) v *= 1000;
  return v > 500000 ? null : v; // sanity cap
}

function renderAnalytics() {
  renderGoal();
  // auto-archived jobs still count under the status they were closed with
  const jobs = allJobs.map(j => j.status === 'archived' && j.archivedFrom ? { ...j, status: j.archivedFrom } : j);
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

  // Average response time: days from appliedDate to first status-change event (interview/rejected/offer)
  const responseTimes = jobs
    .filter(j => j.appliedDate && j.events && j.events.length)
    .map(j => {
      const firstResponse = j.events.find(e => ['interview','offer','rejected'].includes(e.type));
      if (!firstResponse) return null;
      return Math.max(0, Math.round((new Date(firstResponse.date) - new Date(j.appliedDate)) / 86400000));
    })
    .filter(v => v !== null);
  const avgResponse = responseTimes.length
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : null;

  const offerTimes = jobs
    .filter(j => j.status === 'offer' && j.appliedDate && j.statusUpdated)
    .map(j => Math.max(0, Math.round((new Date(j.statusUpdated) - new Date(j.appliedDate)) / 86400000)));
  const avgTimeToOffer = offerTimes.length
    ? Math.round(offerTimes.reduce((a, b) => a + b, 0) / offerTimes.length)
    : null;

  document.getElementById('kpiRow').innerHTML = `
    <div class="kpi-card kpi-clickable" data-kpi-filter="all" title="View all applications">
      <div class="kpi-value c-blue">${total}</div>
      <div class="kpi-label">Total Applied</div>
      <div class="kpi-sub">${active} active in pipeline</div>
    </div>
    <div class="kpi-card kpi-clickable" data-kpi-filter="applied" title="View applied jobs">
      <div class="kpi-value ${responseRate >= 20 ? 'c-green' : responseRate >= 8 ? 'c-yellow' : 'c-red'}">${responseRate}%</div>
      <div class="kpi-label">Response Rate</div>
      <div class="kpi-sub">${responded} of ${total} heard back</div>
    </div>
    <div class="kpi-card kpi-clickable" data-kpi-filter="interview" title="View interviews">
      <div class="kpi-value ${interviewRate >= 10 ? 'c-green' : 'c-yellow'}">${interviewRate}%</div>
      <div class="kpi-label">Interview Rate</div>
      <div class="kpi-sub">${interviewed} interview${interviewed !== 1 ? 's' : ''}</div>
    </div>
    <div class="kpi-card kpi-clickable" data-kpi-filter="offer" title="View offers">
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
    <div class="kpi-card">
      <div class="kpi-value ${avgResponse === null ? 'c-gray' : avgResponse <= 7 ? 'c-green' : avgResponse <= 14 ? 'c-yellow' : 'c-red'}">${avgResponse === null ? '—' : avgResponse + 'd'}</div>
      <div class="kpi-label">Avg Response</div>
      <div class="kpi-sub">${avgResponse === null ? 'No responses yet' : `across ${responseTimes.length} response${responseTimes.length !== 1 ? 's' : ''}`}</div>
    </div>
    <div class="kpi-card kpi-clickable" data-kpi-filter="offer" title="View offers">
      <div class="kpi-value ${avgTimeToOffer === null ? 'c-gray' : avgTimeToOffer <= 21 ? 'c-green' : avgTimeToOffer <= 42 ? 'c-yellow' : 'c-red'}">${avgTimeToOffer === null ? '—' : avgTimeToOffer + 'd'}</div>
      <div class="kpi-label">Avg to Offer</div>
      <div class="kpi-sub">${avgTimeToOffer === null ? 'No offers yet' : `across ${offerTimes.length} offer${offerTimes.length !== 1 ? 's' : ''}`}</div>
    </div>
    ${(() => {
      const msDay = 86400000;
      const now = Date.now();
      const thisWeek = jobs.filter(j => j.appliedDate && (now - new Date(j.appliedDate).getTime()) < 7 * msDay).length;
      const lastWeek = jobs.filter(j => { if (!j.appliedDate) return false; const d = now - new Date(j.appliedDate).getTime(); return d >= 7 * msDay && d < 14 * msDay; }).length;
      const delta = thisWeek - lastWeek;
      const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
      const cls   = delta > 0 ? 'c-green' : delta < 0 ? 'c-red' : 'c-gray';
      const sub   = lastWeek === 0 && thisWeek === 0 ? 'No apps yet this fortnight'
                  : delta === 0 ? `Same as last week (${lastWeek})`
                  : `${Math.abs(delta)} ${delta > 0 ? 'more' : 'fewer'} than last week (${lastWeek})`;
      return `<div class="kpi-card">
        <div class="kpi-value ${cls}">${arrow} ${thisWeek}</div>
        <div class="kpi-label">This Week</div>
        <div class="kpi-sub">${sub}</div>
      </div>`;
    })()}
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

  // Pipeline funnel: applied → interviewed → offered
  const funnelStages = [
    { label: 'Applied',    count: total,      color: '#2563eb' },
    { label: 'Responded',  count: responded,  color: '#6366f1' },
    { label: 'Interviewed',count: interviewed,color: '#16a34a' },
    { label: 'Offered',    count: offered,    color: '#d97706' },
  ];
  const funnelMax = Math.max(total, 1);
  document.getElementById('funnelChart').innerHTML = funnelStages.map((s, i) => {
    const pct   = Math.round(s.count / funnelMax * 100);
    const dropPct = i > 0 && funnelStages[i - 1].count > 0
      ? Math.round(s.count / funnelStages[i - 1].count * 100)
      : null;
    return `
      <div class="funnel-stage">
        <div class="funnel-label">${s.label}</div>
        <div class="funnel-bar-wrap">
          <div class="funnel-bar" style="width:${Math.max(pct, 8)}%;background:${s.color}">${s.count}</div>
          ${dropPct !== null ? `<div class="funnel-meta">${dropPct}% of previous stage</div>` : ''}
        </div>
      </div>`;
  }).join('') + (total === 0 ? '<div style="font-size:12px;color:#94a3b8">No data yet</div>' : '');

  // Source effectiveness: full conversion funnel per application method
  const sourceMap = {};
  for (const j of jobs) {
    const src = j.applicationMethod || 'online';
    if (!sourceMap[src]) sourceMap[src] = { total: 0, interviewed: 0, offered: 0 };
    sourceMap[src].total++;
    if (['interview','offer'].includes(j.status)) sourceMap[src].interviewed++;
    if (j.status === 'offer') sourceMap[src].offered++;
  }
  const sourceLabels = { online: '🌐 Online', linkedin: '🔗 LinkedIn', email: '📧 Email', referral: '🤝 Referral' };
  const sources = Object.entries(sourceMap)
    .map(([k, v]) => {
      const intRate  = v.total ? Math.round(v.interviewed / v.total * 100) : 0;
      const offRate  = v.total ? Math.round(v.offered    / v.total * 100) : 0;
      return { key: k, label: sourceLabels[k] || k, total: v.total, interviewed: v.interviewed, offered: v.offered, intRate, offRate };
    })
    .sort((a, b) => b.intRate - a.intRate);
  const maxTotal = Math.max(...sources.map(s => s.total), 1);
  document.getElementById('sourceChart').innerHTML = sources.length ? `
    <div style="display:grid;grid-template-columns:1fr;gap:10px">
      ${sources.map(s => `
        <div style="padding:10px 0;border-bottom:1px solid var(--border,#e2e8f0)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:13px;font-weight:600">${s.label}</span>
            <span style="font-size:11px;color:#94a3b8">${s.total} applied</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:5px">
            <div style="flex:1;height:8px;background:var(--bg,#f1f5f9);border-radius:4px;overflow:hidden">
              <div style="height:100%;border-radius:4px;background:#6366f1;width:100%"></div>
            </div>
            <span style="font-size:11px;color:#6366f1;width:70px;text-align:right">${s.total} applied</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:5px">
            <div style="flex:1;height:8px;background:var(--bg,#f1f5f9);border-radius:4px;overflow:hidden">
              <div style="height:100%;border-radius:4px;background:${s.intRate >= 20 ? '#16a34a' : s.intRate >= 8 ? '#2563eb' : '#94a3b8'};width:${s.total ? Math.round(s.interviewed/s.total*100) : 0}%"></div>
            </div>
            <span style="font-size:11px;color:${s.intRate >= 20 ? '#16a34a' : s.intRate >= 8 ? '#2563eb' : '#94a3b8'};width:70px;text-align:right">${s.interviewed} interviews (${s.intRate}%)</span>
          </div>
          ${s.offered > 0 ? `
          <div style="display:flex;gap:6px;align-items:center">
            <div style="flex:1;height:8px;background:var(--bg,#f1f5f9);border-radius:4px;overflow:hidden">
              <div style="height:100%;border-radius:4px;background:#f59e0b;width:${s.total ? Math.round(s.offered/s.total*100) : 0}%"></div>
            </div>
            <span style="font-size:11px;color:#f59e0b;width:70px;text-align:right">${s.offered} offers (${s.offRate}%)</span>
          </div>` : ''}
        </div>`).join('')}
    </div>` : '<div style="font-size:12px;color:#94a3b8">No data yet</div>';

  // ── Tag analytics ────────────────────────────────────────────────────────
  const tagMap = {};
  jobs.forEach(j => {
    (j.tags || []).forEach(t => {
      if (!tagMap[t]) tagMap[t] = { total: 0, interviewed: 0, offered: 0 };
      tagMap[t].total++;
      if (['interview','offer'].includes(j.status)) tagMap[t].interviewed++;
      if (j.status === 'offer') tagMap[t].offered++;
    });
  });
  // Top companies chart
  const companyMap = {};
  for (const j of jobs) {
    const c = (j.company || '').trim();
    if (!c) continue;
    if (!companyMap[c]) companyMap[c] = { total: 0, interviewed: 0, offered: 0 };
    companyMap[c].total++;
    if (['interview','offer'].includes(j.status)) companyMap[c].interviewed++;
    if (j.status === 'offer') companyMap[c].offered++;
  }
  const companies = Object.entries(companyMap)
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  const maxCoCount = companies.length ? companies[0].total : 1;
  document.getElementById('companiesChart').innerHTML = companies.length
    ? companies.map(c => {
        const badge = c.offered ? ' 🎉' : c.interviewed ? ' 🗣' : '';
        return `<div class="hbar-row">
          <div class="hbar-label" title="${c.name}">${c.name.length > 18 ? c.name.slice(0, 17) + '…' : c.name}${badge}</div>
          <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(c.total/maxCoCount*100)}%;background:#0891b2"></div></div>
          <div class="hbar-count">${c.total}</div>
        </div>`;
      }).join('')
    : '<div style="font-size:12px;color:#94a3b8">No applications yet</div>';

  const tags = Object.entries(tagMap)
    .map(([tag, d]) => ({ tag, ...d, rate: d.total ? Math.round(d.interviewed / d.total * 100) : 0 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);
  const maxTagCount = tags.length ? tags[0].total : 1;
  document.getElementById('tagChart').innerHTML = tags.length
    ? tags.map(t => `
        <div class="hbar-row">
          <div class="hbar-label" style="color:#6366f1">#${t.tag}</div>
          <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(t.total/maxTagCount*100)}%;background:#6366f1"></div></div>
          <div class="hbar-count">${t.total}</div>
        </div>
        <div style="font-size:10px;color:#94a3b8;margin:-8px 0 10px 86px">${t.interviewed} interview${t.interviewed !== 1 ? 's' : ''}${t.offered ? ` · ${t.offered} offer${t.offered !== 1 ? 's' : ''}` : ''}</div>`)
      .join('')
    : '<div style="font-size:12px;color:#94a3b8">No tagged jobs yet</div>';

  // ── Day-of-week chart ────────────────────────────────────────────────────
  const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dowCounts = [0, 0, 0, 0, 0, 0, 0];
  jobs.forEach(j => {
    const d = new Date(j.appliedDate);
    if (!isNaN(d)) dowCounts[d.getDay()]++;
  });
  const maxDow = Math.max(...dowCounts, 1);
  // reorder Mon–Sun for display
  const dowOrder = [1, 2, 3, 4, 5, 6, 0];
  document.getElementById('dowChart').innerHTML = dowCounts.every(c => c === 0)
    ? '<div style="font-size:12px;color:#94a3b8">No data yet</div>'
    : dowOrder.map(i => {
        const pct = Math.round(dowCounts[i] / maxDow * 100);
        const isTop = dowCounts[i] === maxDow && maxDow > 0;
        return `
          <div class="hbar-row">
            <div class="hbar-label" style="${isTop ? 'color:#16a34a;font-weight:700' : ''}">${DOW_LABELS[i]}</div>
            <div class="hbar-track"><div class="hbar-fill" style="width:${pct}%;background:${isTop ? '#16a34a' : '#2563eb'}"></div></div>
            <div class="hbar-count">${dowCounts[i]}</div>
          </div>`;
      }).join('');

  // ── Resume version performance ───────────────────────────────────────────
  const resumeMap = {};
  jobs.forEach(j => {
    const v = (j.resumeVersion || '').trim();
    if (!v) return;
    if (!resumeMap[v]) resumeMap[v] = { total: 0, interviewed: 0, offered: 0 };
    resumeMap[v].total++;
    if (['interview', 'offer'].includes(j.status)) resumeMap[v].interviewed++;
    if (j.status === 'offer') resumeMap[v].offered++;
  });
  const resumeEntries = Object.entries(resumeMap)
    .map(([v, d]) => ({ v, ...d, rate: d.total ? Math.round(d.interviewed / d.total * 100) : 0 }))
    .sort((a, b) => b.rate - a.rate || b.total - a.total);
  const maxResumeRate = resumeEntries.length ? Math.max(...resumeEntries.map(e => e.rate), 1) : 1;
  document.getElementById('resumeChart').innerHTML = resumeEntries.length
    ? resumeEntries.map((e, i) => `
        <div class="hbar-row">
          <div class="hbar-label" style="${i === 0 ? 'color:#16a34a;font-weight:700' : ''}" title="${e.v}">📄 ${e.v.length > 14 ? e.v.slice(0, 13) + '…' : e.v}</div>
          <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(e.rate / maxResumeRate * 100)}%;background:${i === 0 ? '#16a34a' : '#2563eb'}"></div></div>
          <div class="hbar-count">${e.rate}%</div>
        </div>
        <div style="font-size:10px;color:#94a3b8;margin:-8px 0 10px 86px">${e.total} app${e.total !== 1 ? 's' : ''} · ${e.interviewed} interview${e.interviewed !== 1 ? 's' : ''}${e.offered ? ` · ${e.offered} offer${e.offered !== 1 ? 's' : ''}` : ''}</div>`)
      .join('')
    : '<div style="font-size:12px;color:#94a3b8">Add a resume version to your jobs to see performance data</div>';

  // ── Skills in demand ─────────────────────────────────────────────────────
  const demand = skillDemand(jobs, settings.mySkills || []);
  const topSkills = demand.rows.slice(0, 15);
  const gaps = demand.rows.filter(r => !r.mine).slice(0, 5);
  const maxSkill = Math.max(...topSkills.map(r => r.count), 1);
  document.getElementById('skillDemandChart').innerHTML = topSkills.length
    ? `<div style="font-size:11px;color:#64748b;margin-bottom:10px">From ${demand.totalJds} saved job description${demand.totalJds !== 1 ? 's' : ''} · <span style="color:#16a34a">✓</span> = in your skills</div>` +
      topSkills.map(r => {
        const pct = Math.round(r.count / demand.totalJds * 100);
        return `
        <div class="hbar-row" title="${r.count} job${r.count !== 1 ? 's' : ''} mention ${escHtml(r.skill)} · ${r.interviewed} reached interview">
          <div class="hbar-label" style="${r.mine ? 'color:#16a34a;font-weight:600' : ''}">${r.mine ? '✓ ' : ''}${escHtml(r.skill.length > 14 ? r.skill.slice(0, 13) + '…' : r.skill)}</div>
          <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(r.count / maxSkill * 100)}%;background:${r.mine ? '#16a34a' : '#f59e0b'}"></div></div>
          <div class="hbar-count">${pct}%</div>
        </div>`;
      }).join('') +
      (gaps.length
        ? `<div style="font-size:12px;margin-top:10px;padding:8px 10px;border-radius:6px;background:rgba(245,158,11,.1);color:#b45309">
             Most requested skills you don't list: <strong>${gaps.map(g => escHtml(g.skill)).join(', ')}</strong>
             ${(settings.mySkills || []).length ? '' : ' — add your skills in Settings to see gaps'}
           </div>`
        : '')
    : '<div style="font-size:12px;color:#94a3b8">Save job descriptions on your applications to see which skills employers ask for</div>';

  // Why rejected / ghosted: tally statusReason across those statuses
  const rejMap = {};
  for (const j of jobs) {
    if (!j.statusReason || !['rejected', 'ghosted'].includes(j.status)) continue;
    rejMap[j.statusReason] = (rejMap[j.statusReason] || 0) + 1;
  }
  const rejEntries = Object.entries(rejMap)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
  const maxRej = Math.max(...rejEntries.map(e => e.count), 1);
  document.getElementById('rejectionChart').innerHTML = rejEntries.length
    ? rejEntries.map(e => `
        <div class="hbar-row">
          <div class="hbar-label" title="${e.reason}">${e.reason.length > 20 ? e.reason.slice(0, 19) + '…' : e.reason}</div>
          <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(e.count / maxRej * 100)}%;background:#ef4444"></div></div>
          <div class="hbar-count">${e.count}</div>
        </div>`).join('')
    : '<div style="font-size:12px;color:#94a3b8">No rejection reasons logged yet — set a reason when marking jobs as rejected or ghosted</div>';

  // Recent activity feed
  const activityEvents = [];
  const STATUS_ICON = { applied: '📨', interview: '🗣', offer: '🎉', rejected: '❌', ghosted: '👻', archived: '🗄' };
  const STATUS_COLOR = { applied: '#3b82f6', interview: '#a855f7', offer: '#22c55e', rejected: '#ef4444', ghosted: '#94a3b8', archived: '#94a3b8' };
  for (const j of allJobs) {
    if (j.appliedDate) {
      activityEvents.push({ date: new Date(j.appliedDate), type: 'applied', label: `Applied to ${j.title}`, sub: j.company });
    }
    if (j.statusUpdated && j.statusUpdated !== j.appliedDate && j.status !== 'applied') {
      activityEvents.push({ date: new Date(j.statusUpdated), type: j.status, label: `${j.status.charAt(0).toUpperCase() + j.status.slice(1)}: ${j.title}`, sub: j.company });
    }
    for (const ev of (j.events || [])) {
      if (ev.date) activityEvents.push({ date: new Date(ev.date), type: ev.type || 'interview', label: `${ev.type || 'Event'}: ${j.title}`, sub: j.company });
    }
  }
  activityEvents.sort((a, b) => b.date - a.date);
  const recent = activityEvents.slice(0, 15);
  const feedEl = document.getElementById('activityFeed');
  if (feedEl) {
    feedEl.innerHTML = recent.length
      ? recent.map(ev => {
          const now = Date.now();
          const diff = Math.round((now - ev.date.getTime()) / 86400000);
          const dateStr = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? `${diff}d ago` : ev.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const icon = STATUS_ICON[ev.type] || '📌';
          const color = STATUS_COLOR[ev.type] || '#64748b';
          return `<div class="activity-row">
            <span class="activity-icon">${icon}</span>
            <div class="activity-body">
              <span class="activity-label">${ev.label}</span>
              <span class="activity-sub">${ev.sub}</span>
            </div>
            <span class="activity-date" style="color:${color}">${dateStr}</span>
          </div>`;
        }).join('')
      : '<div style="font-size:12px;color:#94a3b8">No activity yet — start applying to see your timeline here</div>';
  }

  // Salary stats
  const salaries = jobs.map(j => parseSalary(j.salary)).filter(v => v !== null);
  const salaryEl = document.getElementById('salaryStats');
  if (salaryEl) {
    if (salaries.length === 0) {
      salaryEl.innerHTML = '<div style="font-size:12px;color:#94a3b8">No salary data yet — add salaries when you apply to see stats here</div>';
    } else {
      const avg = Math.round(salaries.reduce((a, b) => a + b, 0) / salaries.length);
      const min = Math.min(...salaries);
      const max = Math.max(...salaries);
      const fmt = v => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`;
      const bands = [
        { label: '<$50k',      lo: 0,       hi: 50000  },
        { label: '$50–80k',   lo: 50000,   hi: 80000  },
        { label: '$80–120k',  lo: 80000,   hi: 120000 },
        { label: '$120–150k', lo: 120000,  hi: 150000 },
        { label: '$150k+',    lo: 150000,  hi: Infinity },
      ];
      const bandCounts = bands.map(b => salaries.filter(v => v >= b.lo && v < b.hi).length);
      const maxBand = Math.max(...bandCounts, 1);
      salaryEl.innerHTML =
        `<div class="salary-kpi-row">
          <div class="salary-kpi"><div class="salary-kpi-val">${fmt(avg)}</div><div class="salary-kpi-lbl">Average</div></div>
          <div class="salary-kpi"><div class="salary-kpi-val" style="color:#3b82f6">${fmt(min)}</div><div class="salary-kpi-lbl">Min</div></div>
          <div class="salary-kpi"><div class="salary-kpi-val" style="color:#a855f7">${fmt(max)}</div><div class="salary-kpi-lbl">Max</div></div>
          <div class="salary-kpi"><div class="salary-kpi-val" style="color:#64748b">${salaries.length}</div><div class="salary-kpi-lbl">Jobs with data</div></div>
        </div>`
        + bands.map((b, i) => bandCounts[i] === 0 ? '' : `
          <div class="hbar-row">
            <div class="hbar-label">${b.label}</div>
            <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(bandCounts[i]/maxBand*100)}%;background:#22c55e"></div></div>
            <div class="hbar-count">${bandCounts[i]}</div>
          </div>`).join('');
    }
  }

  // Interview round breakdown
  const roundEl = document.getElementById('roundChart');
  if (roundEl) {
    const ROUND_TYPES = ['Phone Screen', 'Technical', 'System Design', 'Behavioral', 'Final Round', 'HR', 'Take-home'];
    const roundCounts = {};
    for (const j of jobs) {
      for (const ev of (j.events || [])) {
        if (ROUND_TYPES.includes(ev.type)) roundCounts[ev.type] = (roundCounts[ev.type] || 0) + 1;
      }
    }
    const roundEntries = ROUND_TYPES.map(r => ({ type: r, count: roundCounts[r] || 0 })).filter(r => r.count > 0).sort((a, b) => b.count - a.count);
    const maxRound = Math.max(...roundEntries.map(r => r.count), 1);
    const ROUND_COLORS = { 'Phone Screen': '#6366f1', 'Technical': '#ef4444', 'System Design': '#f97316', 'Behavioral': '#eab308', 'Final Round': '#22c55e', 'HR': '#3b82f6', 'Take-home': '#a855f7' };
    roundEl.innerHTML = roundEntries.length
      ? roundEntries.map(r => `
          <div class="hbar-row">
            <div class="hbar-label" title="${r.type}">${r.type.length > 14 ? r.type.slice(0, 13) + '…' : r.type}</div>
            <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(r.count/maxRound*100)}%;background:${ROUND_COLORS[r.type] || '#64748b'}"></div></div>
            <div class="hbar-count">${r.count}</div>
          </div>`).join('')
      : '<div style="font-size:12px;color:#94a3b8">No interview rounds logged yet — use the 🎙 Round button on jobs in the Interview stage</div>';
  }

  // Priority matrix (interest × confidence)
  const matrixEl = document.getElementById('priorityMatrix');
  if (matrixEl) {
    const withRatings = jobs.filter(j => !['rejected','archived','ghosted'].includes(j.status) && (j.interest || j.confidence));
    if (!withRatings.length) {
      matrixEl.innerHTML = '<div style="font-size:12px;color:#94a3b8">No ratings yet — set interest and confidence on your jobs to see the matrix</div>';
    } else {
      const quad = (hi_i, hi_c) => withRatings.filter(j =>
        (hi_i ? (j.interest || 0) >= 4 : (j.interest || 0) < 4) &&
        (hi_c ? (j.confidence || 0) >= 4 : (j.confidence || 0) < 4)
      );
      const q = [
        { jobs: quad(true, true),   title: '🌟 Top Picks',    bg: '#dcfce7', color: '#166534' },
        { jobs: quad(true, false),  title: '🚀 Stretch',      bg: '#fef9c3', color: '#854d0e' },
        { jobs: quad(false, true),  title: '🛡 Safety Net',   bg: '#dbeafe', color: '#1e40af' },
        { jobs: quad(false, false), title: '📋 Filler',       bg: '#f1f5f9', color: '#475569' },
      ];
      matrixEl.innerHTML = `<div class="matrix-grid">${q.map(cell => `
        <div class="matrix-cell" style="background:${cell.bg};color:${cell.color}">
          <div class="matrix-cell-title">${cell.title}</div>
          <div class="matrix-cell-count">${cell.jobs.length}</div>
          <div class="matrix-cell-jobs">${cell.jobs.slice(0, 3).map(j => j.company).join(', ')}</div>
        </div>`).join('')}</div>
        <div style="font-size:10px;color:#94a3b8;margin-top:6px">High = 4–5 stars &nbsp;|&nbsp; Rows: interest &nbsp;|&nbsp; Cols: confidence</div>`;
    }
  }
}
