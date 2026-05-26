// ── Storage helpers ─────────────────────────────────────────────────────────

async function getJobs() {
  const r = await chrome.storage.local.get('jobs');
  return r.jobs || [];
}

async function saveJobs(jobs) {
  await chrome.storage.local.set({ jobs });
}

async function getSettings() {
  const r = await chrome.storage.local.get('settings');
  return r.settings || {
    claudeApiKey: '',
    googleClientId: '',
    followUpDays: 7,
    gmailEnabled: false
  };
}

async function addJob(data) {
  const jobs = await getJobs();
  const job = {
    id: Date.now().toString(),
    title: data.title || 'Unknown Position',
    company: data.company || 'Unknown Company',
    url: data.url || '',
    appliedDate: data.appliedDate || new Date().toISOString(),
    status: 'applied',
    applicationMethod: data.applicationMethod || 'online',
    contactEmail: data.contactEmail || '',
    notes: data.notes || '',
    lastUpdated: new Date().toISOString(),
    followUpSent: false,
    emailThreadIds: [],
    events: [{ date: new Date().toISOString(), type: 'applied', note: 'Applied' }]
  };
  jobs.unshift(job);
  await saveJobs(jobs);
  return job;
}

async function updateJob(id, updates) {
  const jobs = await getJobs();
  const i = jobs.findIndex(j => j.id === id);
  if (i === -1) return null;
  const note = updates._note || `Status updated to ${updates.status || jobs[i].status}`;
  delete updates._note;
  if (updates.status && updates.status !== jobs[i].status) {
    jobs[i].events = jobs[i].events || [];
    jobs[i].events.push({ date: new Date().toISOString(), type: updates.status, note });
  }
  jobs[i] = { ...jobs[i], ...updates, lastUpdated: new Date().toISOString() };
  await saveJobs(jobs);
  return jobs[i];
}

// ── Gmail OAuth ──────────────────────────────────────────────────────────────

async function getGmailToken(interactive = false) {
  const settings = await getSettings();
  if (!settings.googleClientId) return null;

  const redirectUrl = chrome.identity.getRedirectURL();
  const clientId = settings.googleClientId;
  const scope = 'https://www.googleapis.com/auth/gmail.readonly';
  const authUrl =
    `https://accounts.google.com/o/oauth2/auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
    `&response_type=token` +
    `&scope=${encodeURIComponent(scope)}`;

  return new Promise((resolve) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive },
      (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          resolve(null);
          return;
        }
        const match = responseUrl.match(/access_token=([^&]+)/);
        resolve(match ? match[1] : null);
      }
    );
  });
}

// ── Gmail sync ───────────────────────────────────────────────────────────────

async function syncGmail() {
  const settings = await getSettings();
  if (!settings.gmailEnabled || !settings.claudeApiKey || !settings.googleClientId) return;

  const token = await getGmailToken(false);
  if (!token) return;

  const jobs = await getJobs();
  const active = jobs.filter(j => ['applied', 'interview'].includes(j.status));

  for (const job of active) {
    await checkJobEmails(token, job, settings.claudeApiKey);
  }

  await chrome.storage.local.set({ gmailLastSync: new Date().toISOString() });
}

async function checkJobEmails(token, job, apiKey) {
  const q = `"${job.company}" newer_than:60d`;
  let res;
  try {
    res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
  } catch { return; }

  if (!res.ok) return;
  const data = await res.json();
  if (!data.messages) return;

  const jobs = await getJobs();
  const thisJob = jobs.find(j => j.id === job.id);
  if (!thisJob) return;

  const seen = new Set(thisJob.emailThreadIds || []);
  const newMsgs = data.messages.filter(m => !seen.has(m.threadId));

  for (const msg of newMsgs) {
    const content = await getEmailContent(token, msg.id);
    if (!content) continue;

    const kind = await classifyEmail(content, apiKey, job.title, job.company);

    seen.add(msg.threadId);
    const allJobs = await getJobs();
    const j2 = allJobs.find(j => j.id === job.id);
    if (!j2) continue;
    j2.emailThreadIds = [...seen];

    if (kind === 'rejection' && j2.status !== 'rejected') {
      j2.status = 'rejected';
      j2.lastUpdated = new Date().toISOString();
      j2.events = j2.events || [];
      j2.events.push({ date: new Date().toISOString(), type: 'rejected', note: 'Rejection detected via Gmail' });
      await saveJobs(allJobs);
      notify('Application Rejected', `${job.company} sent a rejection for ${job.title}.`);
    } else if (kind === 'interview' && j2.status !== 'interview') {
      j2.status = 'interview';
      j2.lastUpdated = new Date().toISOString();
      j2.events = j2.events || [];
      j2.events.push({ date: new Date().toISOString(), type: 'interview', note: 'Interview invite detected via Gmail' });
      await saveJobs(allJobs);
      notify('Interview Invite!', `${job.company} wants to interview you for ${job.title}!`);
    } else {
      await saveJobs(allJobs);
    }
  }
}

async function getEmailContent(token, msgId) {
  let res;
  try {
    res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
  } catch { return null; }

  if (!res.ok) return null;
  const msg = await res.json();
  const payload = msg.payload || {};
  const headers = payload.headers || [];

  const subject = (headers.find(h => h.name === 'Subject') || {}).value || '';
  let body = '';

  function extractBody(part) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      body = atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
    } else if (part.parts) {
      part.parts.forEach(extractBody);
    }
  }
  extractBody(payload);

  return `Subject: ${subject}\n\n${body.substring(0, 1500)}`;
}

async function classifyEmail(content, apiKey, title, company) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{
          role: 'user',
          content: `This email is about a job application for "${title}" at "${company}". Classify it as exactly one word: rejection, interview, or other.\n\n${content}`
        }]
      })
    });
    if (!res.ok) return 'other';
    const d = await res.json();
    const t = (d.content?.[0]?.text || '').toLowerCase();
    if (t.includes('rejection')) return 'rejection';
    if (t.includes('interview')) return 'interview';
    return 'other';
  } catch { return 'other'; }
}

// ── Follow-up reminders ──────────────────────────────────────────────────────

async function checkFollowUps() {
  const settings = await getSettings();
  const jobs = await getJobs();
  const days = settings.followUpDays || 7;
  const now = Date.now();

  for (const job of jobs) {
    if (job.status !== 'applied') continue;
    if (job.followUpSent) continue;
    if (job.applicationMethod !== 'email') continue;

    const daysSince = (now - new Date(job.appliedDate).getTime()) / 86400000;
    if (daysSince < days) continue;

    const d = Math.floor(daysSince);
    chrome.notifications.create(`followup-${job.id}`, {
      type: 'basic',
      title: 'Follow-up Reminder',
      message: `You applied to ${job.title} at ${job.company} ${d} days ago via email — no response yet.`,
      buttons: [{ title: 'Open Dashboard' }]
    });
  }
}

// ── AI answer ────────────────────────────────────────────────────────────────

async function getAIAnswer(question, context) {
  const settings = await getSettings();
  if (!settings.claudeApiKey) return 'Please add your Claude API key in the extension settings first.';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `Help me answer this job application question. Write a short, genuine answer in simple English. No corporate jargon, no buzzwords, no AI-sounding phrases. Sound like a real person talking. 2-4 sentences max.${context ? `\n\nApplying for: ${context}` : ''}\n\nQuestion: ${question}\n\nWrite the answer directly, nothing else.`
        }]
      })
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      return `API error: ${e.error?.message || res.status}`;
    }

    const d = await res.json();
    return d.content?.[0]?.text || 'Could not generate answer.';
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    title,
    message
  });
}

// ── Event listeners ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('gmail-sync', { periodInMinutes: 15 });
  chrome.alarms.create('followup-check', { periodInMinutes: 60 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'gmail-sync') await syncGmail();
  if (alarm.name === 'followup-check') await checkFollowUps();
});

chrome.notifications.onButtonClicked.addListener((notifId, btnIdx) => {
  if (notifId.startsWith('followup-') && btnIdx === 0) {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    switch (msg.type) {
      case 'JOB_APPLIED':
        const job = await addJob(msg.job);
        notify('Job Tracked!', `${job.title} at ${job.company} added to your tracker.`);
        reply({ ok: true, job });
        break;
      case 'GET_AI_ANSWER':
        reply({ answer: await getAIAnswer(msg.question, msg.context) });
        break;
      case 'GET_JOBS':
        reply({ jobs: await getJobs() });
        break;
      case 'ADD_JOB':
        reply({ job: await addJob(msg.job) });
        break;
      case 'UPDATE_JOB':
        reply({ job: await updateJob(msg.id, msg.updates) });
        break;
      case 'DELETE_JOB': {
        const jobs = await getJobs();
        await saveJobs(jobs.filter(j => j.id !== msg.id));
        reply({ ok: true });
        break;
      }
      case 'GET_SETTINGS':
        reply({ settings: await getSettings() });
        break;
      case 'SAVE_SETTINGS':
        await chrome.storage.local.set({ settings: msg.settings });
        reply({ ok: true });
        break;
      case 'CONNECT_GMAIL':
        const token = await getGmailToken(true);
        reply({ ok: !!token, token });
        break;
      case 'SYNC_GMAIL_NOW':
        await syncGmail();
        reply({ ok: true });
        break;
      case 'GET_REDIRECT_URL':
        reply({ url: chrome.identity.getRedirectURL() });
        break;
      default:
        reply({ ok: false });
    }
  })();
  return true;
});
