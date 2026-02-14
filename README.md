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
3. `faq.html` and `contact.html`
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
3. `product-assetpilot.html` - NyLi Assets detail page
4. `product-flowpilot.html` - NyLi Agent detail page
5. `product-insightpilot.html` - NyLi Insights detail page
6. `faq.html` - frequently asked questions
7. `contact.html` - contact form page
8. `privacy-policy.html` - privacy policy
9. `terms.html` - terms of service
10. `assets/styles.css` - shared site styles
11. `assets/` - favicon and decorative graphics

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

See [CHANGELOG.md](CHANGELOG.md) for recent updates and fixes.

## License

MIT License. See `LICENSE`.


