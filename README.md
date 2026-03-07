# Joyful Innovation Website

This repository contains the public marketing website for **Joyful Innovation**.

It is a lightweight static site (HTML + CSS) used for:

1. Brand presence
2. Product messaging
3. Contact lead capture
4. Basic legal pages (privacy and terms)

## What This Repo Actually Is

This is not an app backend, agent framework, or API service.

It is a content-forward website with hand-edited pages:

1. `index.html` for homepage messaging
2. `products.html` plus product detail pages
3. `support.html` and `contact.html`
4. `privacy-policy.html` and `terms.html`
5. Shared styles and visual assets in `assets/`

## Stack

1. Plain HTML pages
2. Shared CSS in `assets/styles.css`
3. SVG assets for branding/visuals (`assets/favicon.svg`, `assets/human-connection.svg`)

No build step is required for normal content updates.

## File Map

1. `index.html` - homepage
2. `products.html` - product overview
3. `nyli-assets.html` - NyLi Assets detail page
4. `nyli-agent.html` - NyLi Agent detail page
5. `nyli-insights.html` - NyLi Insights detail page
6. `product-assetpilot.html` - legacy redirect shim to `nyli-assets.html`
7. `product-flowpilot.html` - legacy redirect shim to `nyli-agent.html`
8. `product-insightpilot.html` - legacy redirect shim to `nyli-insights.html`
9. `services.html` - services overview
10. `insights.html` - resources landing page
11. `support.html` - support center and knowledge base
12. `contact.html` - contact form page
13. `privacy-policy.html` - privacy policy
14. `terms.html` - terms of service
15. `blog/` - blog article pages
16. `assets/styles.css` - shared site styles
17. `assets/` - JavaScript, favicon, and decorative graphics

## How We Work In This Repo

1. Keep copy and branding consistent across all pages.
2. Keep nav, footer, and legal links aligned site-wide.
3. Favor simple, readable HTML and reusable CSS.
4. Treat this as a production-facing marketing property.

## Typical Update Workflow

1. Create a branch
2. Edit copy/design in relevant HTML/CSS files
3. Review site rendering locally
4. Commit and push
5. Open PR to `main`

## Current Brand Standards

1. Company name: **Joyful Innovation**
2. Header CTA text: **Contact Us**
3. Include links to Privacy Policy and Terms of Service in footer

## Accessibility & Navigation

- All pages include `aria-current="page"` attributes on active navigation links for screen reader support
- Active nav links are styled in brand blue color with bold weight for visual clarity
- All internal links are verified and working
- No broken external resources (favicon.svg reference removed - file not in repo)

## Deployment

Site is deployed to HostGator via GitHub Actions workflow (`.github/workflows/deploy.yml`) on every push to `main` branch.
Set `assets/site-config.js` with the live form submission endpoint before enabling contact and support submissions in production.

See [CHANGELOG.md](CHANGELOG.md) for recent updates and fixes.

## License

MIT License. See `LICENSE`.


