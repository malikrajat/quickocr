# Changelog

All notable changes to Log Lens are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
semantic versioning.

## [1.1.0] - 2026-11-07

### Added

- Manifest V3 extension that captures extension errors, unhandled rejections, opt-in page errors and opt-in network failures.
- Configurable capture levels (debug, info, warn, error, fatal) with error + fatal as the default.
- Persistent ring buffer in `chrome.storage.local` with configurable maximum entries, retention window and a byte budget.
- Automatic log viewer opening with `never`, `on-error` and `always` modes; prefers `chrome.sidePanel` and falls back to a `logs.html` tab when Chrome requires a user gesture.
- Opt-in auto-send to a user-configured HTTPS endpoint, in immediate or scheduled mode, with exponential-backoff retries, an explicit consent checkbox, endpoint permission checks and a dry-run payload preview.
- Manual actions: Email Logs, Export Logs (JSON, CSV, text), Capture Screenshot (panel and visible page), Copy All and Clear Logs.
- Popup summary, side-panel log viewer with search, level/source/time filters and live storage updates, full options page, toolbar error-count badge, notifications and an `Alt+Shift+L` keyboard shortcut.
- Public API through `chrome.runtime.onMessageExternal` with extension-id and web-origin approval lists, a 60/min per-sender rate limit and a versioned `loglens.log` payload.
- DOM-to-image panel capture and `chrome.tabs.captureVisibleTab` page capture, downloaded as local PNGs.
- Local-first privacy pipeline that redacts bearer headers, tokens, API keys, passwords, JWTs, cookies, private keys and URL credentials before storage, export, email or sending.
- Unit tests with `node:test`, Playwright end-to-end tests with the built extension loaded, Biome lint/format, strict TypeScript typecheck, deterministic dist verification and ZIP packaging.
- README documentation with installation, auto-capture, auto-open, auto-send, email, export, screenshot, privacy and public-API guides plus documentation screenshots.

### Changed

- Package and manifest version bumped from 1.0.0 to 1.1.0 (minor).
- No analytics, telemetry or third-party runtime dependencies. All UI is bundled locally.

### Security

- Extension pages use `script-src 'self'`; there is no `unsafe-eval`, `unsafe-inline` or remote code.
- Browser storage is restricted to trusted extension contexts.
- Auto-send requests use `credentials: 'omit'`, `redirect: 'error'`, `referrerPolicy: 'no-referrer'` and do not read response bodies.
- Page capture does not read the DOM, form data, headers or bodies.

## [1.0.0] - 2026-11-07

### Added

- Initial Log Lens design: local error capture, ring-buffer storage, log viewer and export.
- Privacy-first redaction and explicit opt-in delivery model.
