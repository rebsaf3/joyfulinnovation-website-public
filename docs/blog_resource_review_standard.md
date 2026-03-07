# Blog and Resource Review Standard

Use this quality standard before publishing any new blog/resource item.

## Content Quality
1. Clear problem statement in opening section.
2. Practical guidance, not abstract claims.
3. Consistent Joyful Innovation tone (confident, direct, implementation-focused).
4. No unsupported technical or business claims.
5. CTA aligns with intended next action.

## Structure Quality
1. Scannable headings and concise paragraphs.
2. One clear takeaway.
3. At least two relevant internal links when available.
4. Sidebar cards are complete and coherent.

## Taxonomy Quality
1. Category fit is explicit and defensible.
2. Tags improve search discoverability.
3. Title and summary are distinct from existing resources.

## Metadata Quality
1. Canonical URL matches the final route.
2. OG/Twitter metadata reflects final title and summary.
3. JSON-LD Article fields are complete.
4. Publish date and reading time are accurate.

## Technical Quality
1. Entry exists in `assets/data/resources-data.js`.
2. Entry appears in `insights.html` workflows where required.
3. URL added to `sitemap.xml`.
4. `node scripts/validate-static-site.mjs` passes.

## Final Gate
Publish only when all checks above pass with no critical gaps.
