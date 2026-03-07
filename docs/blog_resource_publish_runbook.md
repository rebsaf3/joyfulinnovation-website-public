# Blog and Resource Publish Runbook

This runbook documents the standard process for creating and publishing new blog/resource content.

## Scope
Applies to:
1. New insight pages in `blog/`
2. Resource card registry updates in `assets/data/resources-data.js`
3. Discovery and SEO synchronization in `insights.html` and `sitemap.xml`

## 1. Create Blog Page
1. Create `blog/insight-{slug}.html`.
2. Follow existing structure used by current insight pages:
   - Canonical head metadata
   - Open Graph and Twitter tags
   - JSON-LD Article schema
   - Hero with breadcrumb, title, and publish/read-time line
   - Main article body
   - Four-card sidebar (`Key Takeaway`, `Recommended Next Step`, `More Resources`, `Category`)
3. Ensure these fields are complete and consistent:
   - `<title>`
   - `<meta name="description">`
   - `<link rel="canonical">`
   - `og:title`, `og:description`, `og:url`, `og:image`
   - `twitter:title`, `twitter:description`, `twitter:image`
   - JSON-LD `headline`, `description`, `datePublished`, `mainEntityOfPage`, `image`

## 2. Add Cover Asset
1. Create one new SVG in `assets/insight-post-{N}.svg`.
2. Use the asset in both:
   - Blog page hero image
   - Resource data entry `image`
3. Add meaningful alt text in both places.

## 3. Add Resource Entry
1. Add item object to `assets/data/resources-data.js`.
2. Required fields:
   - `id`
   - `title`
   - `summary`
   - `category`
   - `categoryLabel`
   - `url`
   - `image`
   - `imageAlt`
3. Recommended optional fields:
   - `date`
   - `readingTime`
   - `tags`
   - `featured`

## 4. Sync Discovery and SEO
1. Update `insights.html` ItemList JSON-LD with a new `ListItem` (position and URL).
2. Update `insights.html` noscript section if category list is maintained there for no-JS users.
3. Add new route to `sitemap.xml`.

## 5. Validate
1. Run:
```bash
node scripts/validate-static-site.mjs
```
2. Confirm no missing required files or broken internal links.

## 6. QA Gate
1. Open `/insights` and verify:
   - New card appears
   - Filter/search works
   - Card opens correct route
2. Open each new `/blog/insight-{slug}` page and verify:
   - Hero image and article render correctly
   - Sidebar links resolve
   - Metadata is present and aligned
3. Confirm new URL exists in `sitemap.xml`.

## 7. Commit Guidance
Include only source changes:
1. Blog HTML page(s)
2. SVG asset(s)
3. `assets/data/resources-data.js`
4. `insights.html` (if changed)
5. `sitemap.xml`
6. Any docs or validation script updates

Exclude runtime artifacts (DB files, local logs, generated temporary files).
