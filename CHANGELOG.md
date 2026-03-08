# Changelog

All notable changes to the Joyful Innovation website will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- SEO and accessibility guardrails in `scripts/validate-site-shell.mjs` for canonical URLs, social metadata, skip-link/main structure, single-`h1`, and image `alt` coverage

### Changed
- Expanded the repository standards docs to describe the new SEO/accessibility validation scope

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

