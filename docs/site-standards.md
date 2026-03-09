# Site Standards

## Purpose

This document defines how the Joyful Innovation site is updated without reintroducing layout drift, stale templates, or undocumented operational changes.

The practical goal is simple: one shared public shell, one shared design system, one documented workflow.

## Repo Areas

### Public site

- Root HTML files and `blog/*.html`
- Shared styles and scripts in `assets/`
- Static validation scripts in `scripts/`

### Operational app

- `deploy/reploy-stack/`
- Managed separately from the public marketing site
- Follow `deploy/reploy-stack/README.md` for runtime work there

## Shared Public Shell Standard

All non-redirect public pages must use the same shell pattern already established on the homepage.

Required structural elements:

- `site-header`
- `site-nav`
- `nav-main`
- `nav-utility`
- `site-footer`
- `footer-columns`
- shared `assets/styles.css`
- shared `assets/site.js`

Redirect shim pages are the only exception:

- `product-assetpilot.html`
- `product-flowpilot.html`
- `product-insightpilot.html`

## Styling Rules

- Put visual changes in `assets/styles.css`.
- Avoid inline presentation in HTML.
- Reuse existing utility and layout classes before adding new one-off patterns.
- Preserve the current flatter, more technical visual language unless the task explicitly calls for redesign.
- Keep desktop layouts wide but responsive; do not shrink the content area back to the older narrow baseline.

## Asset Versioning Rules

- Shared CSS and JS includes must keep `?v=` query strings.
- When a shared asset changes, update the version string on every page that references it.
- Do not leave the same asset referenced with multiple versions across pages.

## Required Update Workflow

1. Confirm whether the change belongs to the public site, the operational app, or both.
2. If the public site shell is involved, use `index.html` and `assets/styles.css` as the baseline.
3. Make the smallest coherent change that fixes the root problem.
4. Update asset version strings consistently when shared assets change.
5. Update `CHANGELOG.md`.
6. Update `docs/changes_summary.md` for structural or multi-file work.
7. Run both validators.

## Validation Commands

Run from the repo root:

```powershell
node scripts/validate-static-site.mjs
node scripts/validate-site-shell.mjs
node scripts/validate-repo-governance.mjs
```

Use `pwsh ./run-local.ps1` to serve the public site locally when a browser check is needed.

## Logging Standard

Use two levels of change logging:

- `CHANGELOG.md` for release-style summaries
- `docs/changes_summary.md` for narrative context, rationale, and site-wide work history

If a future agent makes a multi-file fix and does not update both of those where applicable, the work is incomplete.

## CI Guardrail

The deploy workflow is expected to run both validators before publishing.

Treat that workflow as the standing reviewer for:

- broken internal references
- missing required public files
- shell drift
- asset version drift
- inline-style regressions on public pages
- missing core SEO metadata
- missing public accessibility markers such as the skip link, `main-content`, a single `h1`, and `alt` text on images

## Definition Of Done

For public-site work, done means:

1. The page renders correctly.
2. The shared shell remains consistent.
3. Shared asset versioning is aligned.
4. Validation passes locally.
5. The change history is updated.