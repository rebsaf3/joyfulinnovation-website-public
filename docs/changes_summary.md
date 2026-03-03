# Changes Summary

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
  - `NyLi Agent`: assistant interface with early-access positioning
- Added a working product decision helper with goal-based routing.
- Rewrote product pages:
  - `product-assetpilot.html`: tighter opening, workflow steps, use cases, trust/access section.
  - `product-insightpilot.html`: tighter opening, workflow, NL-question/summaries/alerts framing, use cases, trust/access section.
  - `product-flowpilot.html`: conservative availability language, intended capabilities, early access + demo CTAs.

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
- Implemented working client-side taxonomy filter + search on `insights.html`:
  - Guides
  - Case Notes
  - Templates
  - Blog posts
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