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
  '.employer-name'
];

const APPLY_BUTTON_TEXTS = [
  'submit application', 'submit my application', 'apply now', 'easy apply',
  'complete application', 'send application', 'apply for this job',
  'apply for job', 'submit'
];

function isJobPage() {
  const url = window.location.href.toLowerCase();
  return JOB_URL_PATTERNS.some(p => p.test(url));
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
  if (!company) {
    const url = window.location.href;
    const m = url.match(/(?:greenhouse\.io\/|lever\.co\/)([^\/]+)/);
    if (m) company = m[1].replace(/-/g, ' ');
  }

  return { title, company, url: window.location.href };
}

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

  const style = document.createElement('style');
  style.textContent = `@keyframes jt-slide{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`;
  document.head.appendChild(style);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

let appliedThisPage = false;

function trackApplication(info) {
  if (appliedThisPage) return;
  appliedThisPage = true;
  chrome.runtime.sendMessage({ type: 'JOB_APPLIED', job: info }, () => {});
  showToast(info.title, info.company);
  setTimeout(() => { appliedThisPage = false; }, 5000);
}

function setupTracking() {
  if (!isJobPage()) return;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button, a, [role="button"], input[type="submit"]');
    if (!btn) return;
    const text = (btn.textContent || btn.value || '').toLowerCase().trim();
    if (!APPLY_BUTTON_TEXTS.some(kw => text.includes(kw))) return;
    setTimeout(() => trackApplication(extractJobInfo()), 600);
  }, true);

  document.addEventListener('submit', (e) => {
    const form = e.target;
    const hasFile = !!form.querySelector('input[type="file"]');
    const text = form.textContent.toLowerCase();
    const looksLikeApp = hasFile || ['resume', 'cover letter', 'work experience'].some(w => text.includes(w));
    if (!looksLikeApp) return;
    setTimeout(() => trackApplication(extractJobInfo()), 600);
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

function addAIButton(textarea) {
  if (textarea.dataset.jtAi) return;
  textarea.dataset.jtAi = '1';

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;';

  const btn = document.createElement('button');
  btn.textContent = '✨ AI';
  btn.title = 'Get AI-generated answer';
  btn.type = 'button';
  btn.style.cssText = `
    position:absolute;top:6px;right:6px;
    background:#2563eb;color:#fff;border:none;
    border-radius:5px;padding:3px 9px;font-size:11px;
    cursor:pointer;z-index:9999;font-weight:600;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    line-height:1.6;opacity:.9;
  `;

  btn.addEventListener('click', async () => {
    const question = getQuestionLabel(textarea);
    btn.textContent = '...';
    btn.disabled = true;

    const info = isJobPage() ? extractJobInfo() : {};
    const context = [info.title, info.company].filter(Boolean).join(' at ') || '';

    const res = await new Promise(resolve =>
      chrome.runtime.sendMessage({ type: 'GET_AI_ANSWER', question, context }, resolve)
    );

    const answer = res?.answer || '';
    textarea.value = answer;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    btn.textContent = '✨ AI';
    btn.disabled = false;
  });

  const parent = textarea.parentNode;
  if (parent) {
    parent.insertBefore(wrap, textarea);
    wrap.appendChild(textarea);
    wrap.appendChild(btn);
  }
}

function scanTextareas() {
  document.querySelectorAll('textarea').forEach(ta => {
    if (ta.closest('form') || ta.closest('[role="form"]') || isJobPage()) {
      addAIButton(ta);
    }
  });
}

// Watch for dynamically added textareas
const observer = new MutationObserver(() => scanTextareas());
observer.observe(document.body, { childList: true, subtree: true });

setupTracking();
scanTextareas();
