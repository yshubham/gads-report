# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kelvera Reporting Suite — a Google Ads (GADS) reporting and billing dashboard. Pure Node.js backend (no framework), vanilla JS frontend, MongoDB for persistence.

## Commands

- **Run server:** `node server.js` (or `npm start` / `npm run dev`)
- **Smoke tests:** `npm run test:smoke` (hits API endpoints; requires server running)
- No build step, no linter, no TypeScript.

## Architecture

**Monolithic server** (`server.js`, ~1600 lines): raw `http.createServer` handling both API routes and static file serving. No Express or framework.

### Key files

- `server.js` — all API handlers inline, session management, static file serving from `public/`
- `db.js` — MongoDB connection, index creation, initial admin user bootstrap
- `routes/register-routes.js` — route registry mapping `"METHOD /path"` strings to handler functions via a `Map()`
- `lib/validators.js` — input validation helpers
- `data.json`, `brands.json` — file-based data storage (root, NOT inside `public/`)

### Frontend

All client-facing files live in `public/`. No SPA framework. Each page is a separate HTML file with vanilla JS `fetch()` calls. Shared client-side modules in `public/js/`:
- `utils.js` — shared utilities: `normalizeLogoSrc`, `randomInRange`, `getIstDateKey`, `formatIstDate`, `formatIstLongFromKey`, `showStatus`
- `report-api.js` — shared external API functions: `tryFetchReport`, `fetchConversionsForDate`, `getStakeClicks`, `API_BASES`, `STAKE_REPORT_SLUG`
- `internal-nav.js` — role-based navigation injection
- `internal-user-menu.js` — user menu, theme toggle, password change
- `layout-shell.js` — shared footer

### Styling

Custom CSS design system with CSS variables (green-themed). Dark/light theme toggle via `data-theme` attribute on `<html>`. No CSS framework or preprocessor. Key files: `public/css/styles.css` (imports the others), `public/css/theme-light.css`, `public/css/layout.css`, `public/css/components.css`.

## Key Patterns

**Authentication:** Custom HMAC-SHA256 signed session cookies (`kv_session`), 7-day TTL. Two-tier roles: `admin` and `user`. Client users are separate (`client_dashboard_users` collection).

**Multi-tenancy:** Workspace-based isolation. Each internal user owns a workspace; brands are scoped to workspaces. Admins see across all workspaces.

**Dual storage mode:** Most handlers have two code paths — MongoDB (preferred) and legacy file-based fallback (`brands.json`, `credentials.json`, filesystem logos). Controlled by `ALLOW_LEGACY_FILE_AUTH` env var.

**Static file serving:** The server serves files from the project root with path traversal protection. `/` routes to `Login.html`.

## Environment Variables

Required: `SESSION_SECRET`, `MONGODB_URI`
Optional: `PORT` (default 3000), `MONGODB_DB` (default `gads_report`), `ALLOW_LEGACY_FILE_AUTH`, `INITIAL_ADMIN_USERNAME`, `INITIAL_ADMIN_PASSWORD`, `NODE_ENV` (controls Secure cookie flag)

See `.env.example` for the full template.

## MongoDB Collections

`internal_users`, `workspaces`, `brands`, `brand_assets` (logo binaries), `client_dashboard_users`

## Deployment

See `DEPLOYMENT.md` for DigitalOcean deployment guide (PM2, Nginx, Let's Encrypt).
