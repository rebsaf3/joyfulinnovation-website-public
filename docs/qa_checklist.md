# QA Checklist

## Home CTAs
1. Open `index.html` (or `/`) and confirm primary CTA `Request a demo` routes to `/contact?intent=demo`.
2. Confirm secondary CTA `View products` routes to `/products`.
3. Confirm secondary CTA `View services` routes to `/services`.
4. Confirm homepage messaging matches practical outcomes and governance framing.

## Products browsing and decision helper
1. Open `/products` and verify all three products are shown with one-sentence descriptions.
2. Confirm each product block includes:
   - Product page CTA
   - `Request a demo` CTA
3. Use decision helper and verify each goal returns the expected recommendation and routes correctly.

## Each product page CTAs
1. `product-assetpilot`:
   - Verify `Request a demo` routes to `/contact?interest=NyLi%20Assets`.
   - Verify `Go to login options` routes to `/login`.
2. `product-insightpilot`:
   - Verify `Request a demo` routes to `/contact?interest=NyLi%20Insights`.
   - Verify `Go to login options` routes to `/login`.
3. `product-flowpilot`:
   - Verify `Request access` routes to `/contact?interest=NyLi%20Agent`.
   - Verify `Request a demo` routes to `/contact?intent=demo`.

## Login page routing
1. Open `/login` and verify product destinations:
   - NyLi Assets login external link opens.
   - NyLi Insights login external link opens.
   - NyLi Agent login external link opens.
2. Verify NyLi Agent card also offers `Request access` fallback path.

## Contact form submission and success state
1. Open `/contact` and confirm required fields are present.
2. Submit empty form and verify accessible inline validation appears.
3. Fill valid values and submit:
   - If endpoint is configured, verify success message and next-step panel appear.
   - If endpoint is not configured, verify clear configuration error appears.
4. Confirm honeypot field is hidden from normal users.

## Resources filtering and search
1. Open `/insights`.
2. Verify taxonomy chips: `All`, `Guides`, `Case Notes`, `Templates`, `Blog posts`.
3. Apply each filter and confirm card count updates.
4. Enter search terms and verify results narrow correctly.
5. Open at least one resource and verify route resolves.

## Support filtering and search
1. Open `/support`.
2. Verify support path sections show sequence:
   - Self-serve
   - Contact support
   - Consult request
3. Use product dropdown filter and confirm article results update.
4. Use tag chips and search input together; verify result count updates.

## Meta tags and share previews
1. Inspect page source for representative pages (`/`, `/products`, one product page, one blog post).
2. Confirm each has:
   - Unique `<title>`
   - Unique `<meta name="description">`
   - `<link rel="canonical">`
   - OG tags (`og:title`, `og:description`, `og:url`, `og:image`)
   - Twitter tags (`twitter:title`, `twitter:description`, `twitter:image`)
3. Confirm structured data is present:
   - `Organization` on home
   - `Product` on product pages
   - `Article` on blog posts

## Sitemap and robots validation
1. Open `sitemap.xml` and verify URLs map to existing routes.
2. Confirm `login` route is included.
3. Open `robots.txt` and verify sitemap URL is present and correct.
4. Validate sitemap format with an XML validator if needed.

## Mobile nav and keyboard navigation
1. In mobile viewport, verify nav toggle opens/closes links and remains keyboard operable.
2. Use keyboard-only navigation:
   - Skip link appears and jumps to `#main-content`.
   - Focus states are visible on links/buttons/form fields.
   - Form error messaging is announced in status regions.
