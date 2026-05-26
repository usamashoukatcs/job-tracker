# JobTracker — Chrome Extension

A privacy-first Chrome extension that automatically tracks job applications, answers application questions using Claude AI, and syncs Gmail replies to update application statuses.

## Features

- **Auto-tracking** — detects when you submit a job application and logs it
- **AI answers** — click the ✨ AI button on any textarea to get a human-sounding answer via Claude
- **Gmail sync** — reads your inbox every 15 minutes and auto-updates job status (rejection, interview invite)
- **Follow-up reminders** — notifies you when an email application has gone N days without a response, and drafts a follow-up email
- **Dashboard** — full view of all applications with search, filters, status updates, and timeline history
- **100% local** — all data stays in your browser (`chrome.storage.local`); nothing is sent anywhere except Anthropic's API when you click AI

## Setup

### 1. Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this folder

### 2. Configure Claude API (for AI answers)

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. Open the extension → Settings → paste the key → Save

### 3. Configure Gmail sync (optional)

You need a free Google Cloud project:

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project
2. Enable the **Gmail API**
3. Create an **OAuth 2.0 Client ID** (Web application type)
4. Add the redirect URI shown in extension Settings
5. Paste the Client ID into Settings → Connect Gmail

> **Note:** While the OAuth app is in testing mode, add your Gmail address under *APIs & Services → OAuth consent screen → Test users*.

## Privacy

- API keys are stored only in `chrome.storage.local` (your browser, your machine)
- Gmail OAuth tokens are stored locally and used only to read your inbox
- No analytics, no tracking, no external servers beyond Anthropic's API
