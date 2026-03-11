# Changes Summary

## March 2026 — sticky header stability fix
- Fixed a top-of-page sticky-header shake/jitter across public pages by updating `assets/site.js` scroll handling.
- Added hysteresis (separate enter/exit scroll thresholds) so the header no longer rapidly toggles scrolled state near `scrollY=0`.
- Throttled scroll-state updates with `requestAnimationFrame` to reduce layout thrash and visual instability.
- Bumped shared `site.js` asset version to `v=20260310b` across all public HTML pages to ensure browsers pick up the fix immediately.

## March 2026 — governance completion: meta-validator and self-governing state
- Added `scripts/validate-repo-governance.mjs` to close the final governance gap:
  - Checks that all required governance files exist (AGENTS.md, docs/site-standards.md, README.md, CHANGELOG.md, docs/changes_summary.md, both public-site validators, this validator, and deploy.yml).
  - Checks that AGENTS.md contains all required section headings and references all three validators.
  - Checks that docs/site-standards.md contains Purpose, Validation Commands, and Definition Of Done sections and references all three validators.
  - Checks that README.md references all three validators and AGENTS.md.
  - Checks that deploy.yml runs all three validators before deploying.
  - Checks that CHANGELOG.md has at least one version entry.
- Wired `validate-repo-governance.mjs` into `.github/workflows/deploy.yml` as the third pre-deploy validation step.
- Updated AGENTS.md, docs/site-standards.md, and README.md to reference the new governance validator.
- This completes the self-governing baseline: if governance files are removed or degraded, CI will fail before anything deploys.

## Operating expectation going forward
- All three validators must pass before any work is considered done or deployable.
- `CHANGELOG.md` is the concise release log.
- This file remains the narrative context log for major public-site, deployment, and governance changes.
- Shared shell changes should be modeled on `index.html` and `assets/styles.css`, then verified with all three validators before deploy.
- Shared validation protects link integrity, shell consistency, SEO/accessibility baselines, and governance file integrity.

- Fixed the deploy blocker in `scripts/validate-static-site.mjs` so protocol-relative third-party URLs no longer fail the pre-deploy crawl.
- Re-established a single shared public shell across marketing pages and blog pages:
  - standardized header markup
  - standardized footer markup
  - corrected malformed shared script includes
- Widened the desktop layout and tightened spacing so the public site uses a broader, more deliberate responsive baseline.
- Shifted the visual language away from soft gradients and toward a flatter, more technical presentation in shared components.
- Added server-side no-cache headers to reduce stale frontend asset behavior during rollout windows.
- Added repo governance artifacts so future work starts from the now-clean baseline instead of re-solving the same consistency problems:
  - `AGENTS.md`
  - `docs/site-standards.md`
  - `scripts/validate-site-shell.mjs`
- Extended CI validation so deploys now fail if the public shell drifts, if the same shared asset is referenced with multiple versions, or if inline styles reappear on public pages.

## Operating expectation going forward
- `CHANGELOG.md` is the concise release log.
- This file remains the narrative context log for major public-site, deployment, and governance changes.
- Shared shell changes should be modeled on `index.html` and `assets/styles.css`, then verified with both validators before deploy.
- Shared validation now also protects basic SEO and accessibility baselines, not just link integrity and shell consistency.

## Conversion and copy
- Rewrote the homepage hero and first-scroll sections for immediate clarity with required CTAs:
  - Primary: `Request a demo`
  - Secondary: `View products`, `View services`
- Added homepage trust framing aligned to source materials (who Joyful Innovation serves, practical outcomes, and governance/adoption focus).
- Added homepage sections for concrete deliverables and how Joyful Innovation works.
- Removed unsupported hard claims (including unsupported pricing/security/feature specifics where source text did not confirm them).

## Products messaging
- Reworked `products.html` to position products consistently:
  - `NyLi Assets`: content and knowledge backbone
  - `NyLi Insights`: analytics and decision visibility
  - `NyLi Agent`: assistant interface for production workflow deployment
- Added a working product decision helper with goal-based routing.
- Rewrote product pages:
  - `nyli-assets.html`: tighter opening, workflow steps, use cases, trust/access section.
  - `nyli-insights.html`: tighter opening, workflow, NL-question/summaries/alerts framing, use cases, trust/access section.
  - `nyli-agent.html`: production availability language, intended capabilities, onboarding + demo CTAs.

## Services messaging
- Rewrote `services.html` for outcome-based positioning and scannability.
- Added engagement model sections:
  - Discovery and strategy
  - Implementation and integration
  - Enablement and operating cadence
- Updated consult CTA routing to Contact with service intent.

## Contact and forms
- Reworked `contact.html` as sales/partnership-oriented (not support-first).
- Implemented required fields:
  - Name
  - Work email
  - Company
  - Interest selector (`Services`, `NyLi Assets`, `NyLi Insights`, `NyLi Agent`, `Partnerships`, `Other`)
  - Message
- Added bot mitigation and validation:
  - Honeypot field (`company_website`)
  - Client validation with accessible error states and status messages
- Added success state with clear next steps.
- Implemented static-site submission integration pattern via configurable endpoint in `assets/site-config.js` and handler in `assets/contact.js`.

## Resources and support
- Converted Resources to data-driven rendering:
  - `assets/data/resources-data.js`
  - `assets/resources.js`
- Overhauled `/insights` page and renamed it “Resources”: page title, breadcrumb, nav, meta tags, schema, hero copy, and search placeholder rewritten; buzzword-free framing and high‑level topic taxonomy introduced.
- Added persistent popular starting points and dynamic featured‑resources container; simplified tag taxonomy to six high-level topics; quick filters relabeled (All, Guides, Case notes, Templates, Articles); default sort now favors newest when dates exist; JS fixes eliminated flash-of-zero, corrected counts, and improved empty state messaging.
- Converted Support knowledge entries to data-driven rendering:
  - `assets/data/support-data.js`
  - `assets/support.js`
- Implemented working support filters/search and clear support path:
  - Self-serve first
  - Then contact support
  - Then consult request

## SEO
- Added unique title and meta description coverage to all public pages.
- Added canonical tags for all pages.
- Added Open Graph and Twitter card metadata for all pages.
- Added structured data:
  - `Organization` on home page
  - `Product` JSON-LD on product pages
  - `Article` JSON-LD on blog posts
- Rebuilt `sitemap.xml` to include all public top-level pages and blog posts.
- Confirmed and normalized `robots.txt` with sitemap reference.

## Accessibility
- Added skip-to-content links site-wide.
- Standardized keyboard-accessible navigation with toggle button semantics.
- Ensured one `H1` per page and verified heading structure consistency.
- Added visible focus styles for links, buttons, form controls.
- Added explicit labels, error messaging hooks, and status regions for forms.
- Kept meaningful alt text for key images and ensured non-decorative images remain described.

## Performance
- Replaced and simplified the shared stylesheet (`assets/styles.css`) to remove duplicate/legacy rules.
- Moved page interaction logic into external deferred scripts (`site.js`, `contact.js`, `resources.js`, `support.js`, `products.js`).
- Added lazy-loading/async decoding behavior for non-critical images via shared script.
- Added consistent image aspect handling in CSS to reduce layout shift.

## Broken links and routing fixes
- Standardized header/footer links across all HTML files.
- Added dedicated `login.html` page and updated nav `Login` links site-wide.
- Validated internal links with a full crawl; no broken internal links remain.
- Removed invalid legacy login host reference (`nyli.railway.internal`) from public navigation paths.
- Kept existing public routes intact (`/products`, `/services`, `/insights`, `/support`, product pages, blog routes).

## Source-of-truth note
- The required `docs/source_text/*.md` files were not present initially.
- Matching source `.docx` files in `docs/source/` were converted into:
  - `docs/source_text/Joyful_Innovation_Overview.md`
  - `docs/source_text/NyLi_Assets_Product_Overview.md`
  - `docs/source_text/NyLi_Insights_Product_Overview.md`
  - `docs/source_text/NyLi_Agent_Product_Overview.md`
- Copy edits were grounded against those generated markdown files.
