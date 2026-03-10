# Changelog

All notable changes to the Joyful Innovation website will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Contact page layout: replaced unreliable CSS `order` property on `.contact-form-shell` and `.contact-info-card` with explicit `grid-column` / `grid-row` placement, eliminating the blank-left-column rendering bug on desktop. Mobile responsive overrides updated to reset to auto placement.
- Contact page sizing: updated `.contact-split` to `align-items: stretch` and set `.contact-form-shell` and `.contact-info-card` to `height: 100%` so both desktop columns render the same height. `styles.css` bumped to `v=20260309b` across all 35 HTML files.

### Added
- `scripts/validate-repo-governance.mjs` — meta-validator that checks governance files are present and contain required sections; prevents silent governance layer degradation
- Contact form now POSTs JSON to CRM endpoint `https://leber-crm-production.up.railway.app/api/public/lead-forms/lcrm0contact0us0form0001/submit` with fields `name`, `email`, `phone`, `company`, and `message` (interest prepended to message text)

### Changed
- `assets/site-config.js`: set `provider` to `crm` and populated `endpoint` with the CRM lead-form submit URL (`v=20260308b`)
- `assets/contact.js`: replaced `FormData` submission with `JSON.stringify` payload and `Content-Type: application/json` header (`v=20260308b`)
- SEO and accessibility guardrails in `scripts/validate-site-shell.mjs` for canonical URLs, social metadata, skip-link/main structure, single-`h1`, and image `alt` coverage

### Changed
- Added `validate-repo-governance.mjs` step to `deploy.yml` so governance integrity is enforced on every deploy
- Updated `AGENTS.md`, `docs/site-standards.md`, and `README.md` to reference all three validators
- Expanded the repository standards docs to describe the new SEO/accessibility validation scope
- Updated deployment workflow steps list in `README.md` to reflect the new governance validation step

## [1.4.0] - 2026-03-08

### Added
- Repository-wide agent instructions in `AGENTS.md`
- Public-site operating procedure in `docs/site-standards.md`
- `scripts/validate-site-shell.mjs` to enforce shared shell, asset version alignment, and public-page markup standards

### Changed
- Updated `README.md` to reflect the actual repo architecture, validation workflow, and documentation requirements
- Extended the deploy workflow to run shell consistency validation before publish
- Updated `docs/changes_summary.md` to capture the March 2026 site hardening and consistency work

## [1.3.0] - 2026-03-08

### Fixed
- Normalized the shared public header across marketing and blog pages so navigation placement and logo sizing render consistently
- Normalized the shared public footer across public pages and removed legacy footer variants
- Corrected malformed shared script includes on public pages
- Added server-side no-cache headers in `.htaccess` to reduce stale asset delivery during rollout windows

### Changed
- Standardized public script include versions for `site.js` and page-specific JS assets
- Completed a site-wide shell consistency pass across the public marketing surface

## [1.2.0] - 2026-03-07

### Fixed
- Updated `scripts/validate-static-site.mjs` so protocol-relative third-party URLs are treated as external references instead of broken internal links
- Unblocked the deploy pipeline by fixing the pre-deploy validation failure that prevented updated frontend assets from publishing
- Hardened public-site request handling with HSTS and a tighter request body limit in the deployed app surface
- Prevented unnecessary password re-hashing during server-side auth flows
- Improved response tracking performance by removing an expensive repeated bcrypt comparison pattern

### Changed
- Widened the public desktop content container while keeping responsive gutters intact
- Added shared spacing utilities and removed public-page inline spacing drift
- Refined the visual system toward a flatter, more technical style across shared public components
- Updated deployment defaults to prefer FTPS and added a test gate before deploy
- Updated the public Docker/runtime configuration for safer default execution

### Security
- Explicitly excluded `.env` and credential-like artifacts from deploy and version-control paths
- Updated Stripe API configuration to the current supported version in the operational app

## [1.1.0] - 2026-02-13

### Fixed
- Fixed literal `\r\n` characters appearing in navigation and footer links on the legal pages
- Removed broken favicon references from public HTML pages
- Cleaned up malformed navigation markup for more reliable rendering

### Added
- Added `aria-current="page"` support for active navigation states across the public site
- Added shared active-nav styling in `assets/styles.css`
- Standardized public CTA language across core product pages

### Changed
- Unified HTML head section formatting across all pages
- Improved semantic HTML structure for better accessibility
- Standardized footer link structure across all pages

### Testing
- ✅ All internal links verified and working
- ✅ Navigation active states display correctly
- ✅ No broken external resources
- ✅ Screen reader compatibility improved with `aria-current` support

## [1.0.0] - 2026-02-12

### Added
- Initial site launch
- Core pages: Home, Products, Insights, Support, Contact
- Product detail pages: NyLi Assets, NyLi Agent, NyLi Insights
- Legal pages: Privacy Policy, Terms of Service
- Responsive CSS framework
- HostGator FTP deployment workflow via GitHub Actions

