// Runs on every page. Only activates when page looks like a job application.

const JOB_URL_PATTERNS = [
  /linkedin\.com\/jobs/,
  /indeed\.com/,
  /glassdoor\.com/,
  /greenhouse\.io/,
  /lever\.co/,
  /workday\.com/,
  /myworkdayjobs\.com/,
  /smartrecruiters\.com/,
  /jobvite\.com/,
  /icims\.com/,
  /taleo\.net/,
  /successfactors\.(eu|com)/,
  /bamboohr\.com/,
  /careers\./,
  /jobs\./,
  /\/jobs\//,
  /\/careers\//,
  /\/apply\//,
  /\/job\//
];

const TITLE_SELECTORS = [
  'h1.job-details-jobs-unified-top-card__job-title',
  '[data-testid="jobTitle"]',
  'h1.app-title',
  '[data-automation-id="jobPostingHeader"]',
  '.job-title',
  '.posting-headline h2',
  '.job-header h1',
  'h1'
];

const COMPANY_SELECTORS = [
  '.job-details-jobs-unified-top-card__company-name a',
  '[data-testid="inlineHeader-companyName"] a',
  '.company-name',
  '[data-automation-id="company"]',
  '.jobs-unified-top-card__company-name',
  '.posting-categories .sort-by-time',
  '.employer-name',
  '[data-testid="companyName"]',
  '.jobsearch-InlineCompanyRating a',
  '[class*="company"] a',
  '[class*="Company"] a'
];

// Final submission buttons — these confirm the application was actually sent
const FINAL_SUBMIT_RE = /\b(submit(\s*my)?\s*application|complete\s*application|send(\s*my)?\s*application|finish\s*application|submit\s*and\s*apply)\b/i;
// "Apply" buttons that just start the process — only used to track on form submit, not on click
const APPLY_START_RE = /\b(apply(\s*(now|here|for\s*(this\s*)?(job|position|role)))?|easy\s*apply|quick\s*apply|one.click\s*apply)\b/i;

function isJobPage() {
  const url = window.location.href.toLowerCase();
  return JOB_URL_PATTERNS.some(p => p.test(url));
}

function extractCompanyFromUrl(url) {
  try {
    const { hostname } = new URL(url);
    let m;
    // boards.greenhouse.io/COMPANY/jobs/123
    m = url.match(/greenhouse\.io\/([^\/\?]+)/);
    if (m) return m[1].replace(/-/g, ' ');
    // jobs.lever.co/COMPANY/
    m = url.match(/lever\.co\/([^\/\?]+)/);
    if (m) return m[1].replace(/-/g, ' ');
    // COMPANY.bamboohr.com
    m = hostname.match(/^([^.]+)\.bamboohr\.com/);
    if (m) return m[1].replace(/-/g, ' ');
    // COMPANY.wd1.myworkdayjobs.com or COMPANY.workday.com
    m = hostname.match(/^([^.]+)\.(wd\d+\.myworkday|workday)\.com/);
    if (m) return m[1].replace(/-/g, ' ');
    // careers.smartrecruiters.com/COMPANY/
    m = url.match(/smartrecruiters\.com\/([^\/\?]+)/);
    if (m) return m[1].replace(/-/g, ' ');
    // jobs.jobvite.com/COMPANY/
    m = url.match(/jobvite\.com\/([^\/\?]+)/);
    if (m) return m[1].replace(/-/g, ' ');
    // careers.COMPANY.com or jobs.COMPANY.com
    m = hostname.match(/^(?:careers|jobs)\.([^.]+)\./);
    if (m) return m[1].replace(/-/g, ' ');
  } catch {}
  return '';
}

const DESCRIPTION_SELECTORS = [
  // LinkedIn
  '.jobs-description__container',
  '.jobs-box__html-content',
  // Indeed
  '#jobDescriptionText',
  // Greenhouse
  '#content .section-wrapper',
  // Lever
  '.section .description',
  // Workday
  '[data-automation-id="jobPostingDescription"]',
  // SmartRecruiters
  '.job-sections',
  // BambooHR
  '#job-description',
  // Generic
  '[class*="job-description"]',
  '[class*="jobDescription"]',
  '[id*="job-description"]',
  '[id*="jobDescription"]',
  '[class*="job-details"]',
  '[id*="job-details"]',
  '.description',
  'article'
];

function extractJobDescription() {
  for (const sel of DESCRIPTION_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.innerText?.trim();
      if (text && text.length > 100) return text.slice(0, 2000);
    }
  }
  return '';
}

function extractJobInfo() {
  let title = '';
  for (const sel of TITLE_SELECTORS) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim()) { title = el.textContent.trim(); break; }
  }
  if (!title) {
    const parts = document.title.split(/[\|\-–]/);
    title = parts[0].trim();
  }

  let company = '';
  for (const sel of COMPANY_SELECTORS) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim()) { company = el.textContent.trim(); break; }
  }
  if (!company) company = extractCompanyFromUrl(window.location.href);

  return { title, company, url: window.location.href };
}

const JT_STYLE = document.createElement('style');
JT_STYLE.textContent = `@keyframes jt-slide{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`;
document.head.appendChild(JT_STYLE);

function showToast(title, company) {
  const old = document.getElementById('jt-toast');
  if (old) old.remove();

  const t = document.createElement('div');
  t.id = 'jt-toast';
  t.style.cssText = `
    position:fixed;bottom:24px;right:24px;
    background:#2563eb;color:#fff;
    padding:12px 18px;border-radius:10px;
    box-shadow:0 4px 20px rgba(0,0,0,.18);
    z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    font-size:14px;display:flex;align-items:center;gap:10px;
    animation:jt-slide .3s ease;
  `;
  t.innerHTML = `
    <span style="font-size:20px">✓</span>
    <div>
      <div style="font-weight:700;font-size:13px">Job Tracked!</div>
      <div style="font-size:12px;opacity:.85">${title || 'Position'} @ ${company || 'Company'}</div>
    </div>
  `;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function showDuplicateToast(title, company, appliedDate) {
  const old = document.getElementById('jt-toast');
  if (old) old.remove();

  const dateStr = appliedDate
    ? new Date(appliedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'previously';

  const t = document.createElement('div');
  t.id = 'jt-toast';
  t.style.cssText = `
    position:fixed;bottom:24px;right:24px;
    background:#d97706;color:#fff;
    padding:12px 18px;border-radius:10px;
    box-shadow:0 4px 20px rgba(0,0,0,.18);
    z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    font-size:14px;display:flex;align-items:center;gap:10px;
    animation:jt-slide .3s ease;
  `;
  t.innerHTML = `
    <span style="font-size:20px">⚠️</span>
    <div>
      <div style="font-weight:700;font-size:13px">Already Applied!</div>
      <div style="font-size:12px;opacity:.9">${title || 'This job'} @ ${company || 'this company'} — tracked on ${dateStr}</div>
    </div>
  `;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

let appliedThisPage = false;

async function trackApplication(info) {
  if (appliedThisPage) return;
  appliedThisPage = true;

  const res = await new Promise(resolve =>
    chrome.runtime.sendMessage({ type: 'JOB_APPLIED', job: info }, resolve)
  );

  if (res?.duplicate) {
    showDuplicateToast(info.title, info.company, res.appliedDate);
  } else {
    showToast(info.title, info.company);
  }

  setTimeout(() => { appliedThisPage = false; }, 30000);
}

function setupTracking() {
  if (!isJobPage()) return;

  // Traditional form submit (works on non-SPA sites)
  document.addEventListener('submit', (e) => {
    const form = e.target;
    const hasFile   = !!form.querySelector('input[type="file"]');
    const hasResume = /resume|cover.?letter|work.?experience/i.test(form.textContent);
    if (!hasFile && !hasResume) return;
    trackApplication(extractJobInfo());
  }, true);

  // Click-based tracking for SPAs (LinkedIn Easy Apply, etc.) that never fire a form submit.
  // Only fires on final submission buttons — bare "Apply Now" clicks just start the flow
  // and would double-track on multi-step applications.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('button, a, [role="button"], input[type="submit"]');
    if (!el) return;
    const text = (el.textContent || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (!FINAL_SUBMIT_RE.test(text) && !APPLY_START_RE.test(text)) return;
    // For "Apply Now" type buttons, only track if there's no form on the page
    // (meaning this IS the final action, e.g. LinkedIn Easy Apply one-click)
    if (APPLY_START_RE.test(text) && !FINAL_SUBMIT_RE.test(text)) {
      const hasForm = !!document.querySelector('form input[type="text"], form textarea, form input[type="file"]');
      if (hasForm) return;
    }
    trackApplication(extractJobInfo());
  }, true);
}

// ── AI answer button injection ───────────────────────────────────────────────

function getQuestionLabel(textarea) {
  if (textarea.id) {
    const lbl = document.querySelector(`label[for="${textarea.id}"]`);
    if (lbl) return lbl.textContent.trim();
  }
  const parentLabel = textarea.closest('label');
  if (parentLabel) return parentLabel.textContent.trim();

  let el = textarea;
  for (let i = 0; i < 5; i++) {
    el = el.previousElementSibling;
    if (!el) break;
    if (['LABEL', 'P', 'SPAN', 'LEGEND', 'DIV'].includes(el.tagName) && el.textContent.trim().length > 3) {
      return el.textContent.trim();
    }
  }
  return textarea.placeholder || textarea.getAttribute('aria-label') || 'this question';
}

// Floating AI button — uses position:fixed so it never breaks site layouts
function addAIButton(textarea) {
  if (textarea.dataset.jtAi) return;
  textarea.dataset.jtAi = '1';

  const btn = document.createElement('button');
  btn.textContent = '✨ AI';
  btn.title = 'Fill with AI answer';
  btn.type = 'button';
  btn.style.cssText = `
    position:fixed;display:none;
    background:#2563eb;color:#fff;border:none;
    border-radius:6px;padding:4px 11px;font-size:11px;font-weight:700;
    cursor:pointer;z-index:2147483647;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    line-height:1.7;box-shadow:0 2px 10px rgba(37,99,235,.4);
    letter-spacing:.2px;
  `;
  document.body.appendChild(btn);

  function reposition() {
    const r = textarea.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > window.innerHeight) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = 'block';
    btn.style.top  = Math.max(4, r.top + 6) + 'px';
    btn.style.left = (r.right - btn.offsetWidth - 8) + 'px';
  }

  textarea.addEventListener('focus', reposition);
  textarea.addEventListener('blur', e => {
    if (e.relatedTarget === btn) return;
    btn.style.display = 'none';
  });
  // prevent blur on textarea when clicking the button
  btn.addEventListener('mousedown', e => e.preventDefault());

  window.addEventListener('scroll', () => { if (btn.style.display !== 'none') reposition(); }, true);
  window.addEventListener('resize', () => { if (btn.style.display !== 'none') reposition(); });

  btn.addEventListener('click', async () => {
    const question = getQuestionLabel(textarea);
    btn.textContent = '…';
    btn.disabled = true;

    const info = isJobPage() ? extractJobInfo() : {};
    const context = [info.title, info.company].filter(Boolean).join(' at ') || '';
    const description = extractJobDescription();

    const res = await new Promise(resolve =>
      chrome.runtime.sendMessage({ type: 'GET_AI_ANSWER', question, context, description }, resolve)
    );

    const answer = res?.answer || '';
    textarea.value = answer;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    btn.textContent = '✨ AI';
    btn.disabled = false;
    reposition();
  });
}

function scanTextareas() {
  document.querySelectorAll('textarea').forEach(ta => {
    if (ta.closest('form') || ta.closest('[role="form"]') || isJobPage()) {
      addAIButton(ta);
    }
  });
}

// Watch for dynamically added textareas (SPAs load forms late)
const observer = new MutationObserver(() => scanTextareas());
observer.observe(document.body, { childList: true, subtree: true });

// ── Gmail compose tracking ────────────────────────────────────────────────────

const GMAIL_JOB_KEYWORDS = [
  'application', 'applying', 'apply', 'position', 'role', 'resume', 'cv',
  'curriculum vitae', 'cover letter', 'vacancy', 'opportunity', 'candidacy', 'hiring'
];

function looksLikeJobEmail(subject, body) {
  // Replies and forwards are never new applications
  if (/^(re|fwd?):/i.test(subject.trim())) return false;
  const text = (subject + ' ' + body).toLowerCase();
  return GMAIL_JOB_KEYWORDS.filter(kw => text.includes(kw)).length >= 2;
}

function getComposeInfo(compose) {
  const subject  = compose.querySelector('input[name="subjectbox"]')?.value?.trim() || '';
  const toChip   = compose.querySelector('[email]');
  const toEmail  = toChip ? toChip.getAttribute('email') : '';
  const bodyEl   = compose.querySelector('[contenteditable="true"][aria-multiline="true"], [contenteditable="true"].Am');
  const body     = bodyEl?.innerText?.trim() || '';
  return { subject, toEmail, body };
}

function parseSubjectForJob(subject) {
  // "Application for Software Engineer at Google" or "Re: SWE role @ Meta"
  const m = subject.match(/(?:for|re:?\s+)(.+?)\s+(?:at|@)\s+(.+)/i);
  if (m) return { title: m[1].trim(), company: m[2].trim() };
  return { title: '', company: '' };
}

function showJobApplicationPrompt(subject, toEmail) {
  const old = document.getElementById('jt-gmail-prompt');
  if (old) old.remove();

  const { title, company } = parseSubjectForJob(subject);

  const prompt = document.createElement('div');
  prompt.id = 'jt-gmail-prompt';
  prompt.style.cssText = `
    position:fixed;bottom:80px;right:24px;
    background:#fff;color:#1e293b;border-radius:12px;
    padding:16px 18px;box-shadow:0 8px 32px rgba(0,0,0,.18);
    z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    font-size:13px;width:290px;border:1px solid #e2e8f0;
    animation:jt-slide .3s ease;
  `;
  prompt.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <span style="font-size:18px">💼</span>
      <strong style="font-size:13px;flex:1">Track this job application?</strong>
      <button id="jt-gp-close" style="background:none;border:none;cursor:pointer;font-size:18px;color:#94a3b8;padding:0;line-height:1">×</button>
    </div>
    <input id="jt-gp-title" placeholder="Job title" value="${title}" style="
      width:100%;padding:7px 10px;border:1.5px solid #e2e8f0;border-radius:7px;
      font-size:12px;margin-bottom:7px;outline:none;font-family:inherit;box-sizing:border-box;
    ">
    <input id="jt-gp-company" placeholder="Company name" value="${company}" style="
      width:100%;padding:7px 10px;border:1.5px solid #e2e8f0;border-radius:7px;
      font-size:12px;margin-bottom:11px;outline:none;font-family:inherit;box-sizing:border-box;
    ">
    <div style="display:flex;gap:8px">
      <button id="jt-gp-add" style="
        flex:1;padding:8px;background:#2563eb;color:#fff;border:none;
        border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;
      ">Track Job</button>
      <button id="jt-gp-skip" style="
        padding:8px 14px;background:#f1f5f9;color:#64748b;border:none;
        border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;
      ">Skip</button>
    </div>
  `;
  document.body.appendChild(prompt);

  const close = () => prompt.remove();
  document.getElementById('jt-gp-close').onclick = close;
  document.getElementById('jt-gp-skip').onclick  = close;

  document.getElementById('jt-gp-add').onclick = async () => {
    const jobTitle   = document.getElementById('jt-gp-title').value.trim()   || subject || 'Unknown Position';
    const jobCompany = document.getElementById('jt-gp-company').value.trim() || 'Unknown Company';
    await new Promise(resolve =>
      chrome.runtime.sendMessage({
        type: 'ADD_JOB',
        job: { title: jobTitle, company: jobCompany, contactEmail: toEmail, applicationMethod: 'email', status: 'applied' }
      }, resolve)
    );
    close();
    showToast(jobTitle, jobCompany);
  };

  // Auto-dismiss after 20 seconds
  setTimeout(() => { if (document.contains(prompt)) close(); }, 20000);
}

function setupGmailTracking() {
  if (!window.location.hostname.includes('mail.google.com')) return;

  const gmailObserver = new MutationObserver(() => {
    document.querySelectorAll('input[name="subjectbox"]').forEach(subjectInput => {
      const compose = subjectInput.closest('[role="dialog"]') || subjectInput.parentElement?.closest('div[class]');
      if (!compose || compose.dataset.jtGmail) return;

      // Find the send button — Gmail uses data-tooltip starting with "Send"
      const sendBtn = compose.querySelector('[data-tooltip^="Send"], [aria-label^="Send "]');
      if (!sendBtn) return;
      compose.dataset.jtGmail = '1';

      sendBtn.addEventListener('click', () => {
        const { subject, toEmail, body } = getComposeInfo(compose);
        if (!looksLikeJobEmail(subject, body)) return;
        // Small delay so email sends before the prompt appears
        setTimeout(() => showJobApplicationPrompt(subject, toEmail), 1500);
      });
    });
  });

  gmailObserver.observe(document.body, { childList: true, subtree: true });
}

setupTracking();
scanTextareas();
setupGmailTracking();
