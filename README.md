# Joyful Innovation Website

This repository contains the public Joyful Innovation website and its deployment guardrails.

The root of the repo is a static marketing site. A separate operational application lives under `deploy/reploy-stack/` and should be treated as a different surface with its own runtime and instructions.

## Repo Layout

### Public site

- Root HTML pages for marketing, product, legal, and support content
- `blog/` for article pages
- `assets/` for shared CSS, JS, data, and imagery
- `scripts/` for static validation checks used before deploy

### Operational app

- `deploy/reploy-stack/` for the NyLi operational stack
- Follow `deploy/reploy-stack/README.md` for runtime work in that area

## Public Site Stack

The public site is intentionally simple:

1. Plain HTML pages
2. Shared CSS in `assets/styles.css`
3. Shared behavior in `assets/site.js`
4. Page-specific scripts where needed
5. Data-driven listing pages powered by `assets/data/*.js`

There is no frontend build step for standard public-site updates.

## Source Of Truth

Use these files as the baseline for future work:

1. `AGENTS.md` for repository-wide agent instructions
2. `docs/site-standards.md` for the operating procedure and definition of done
3. `assets/styles.css` for visual system, layout, spacing, and shared components
4. `index.html` for the canonical public header/footer shell
5. `CHANGELOG.md` for release-style change history
6. `docs/changes_summary.md` for narrative context and site-wide work history

## Public Site Standards

These rules are enforced both by documentation and CI:

1. Keep the shared public header consistent across all non-redirect public pages.
2. Keep the shared public footer consistent across all non-redirect public pages.
3. Do not add inline `style=` attributes to public pages.
4. Do not allow asset version drift for the same shared file across pages.
5. Update the changelog and narrative summary for structural, deploy, security, or multi-file work.

## Local Workflow

Serve the public site locally with:

```powershell
pwsh ./run-local.ps1
```

The default local URL is `http://localhost:5500/index.html`.

## Validation

Run both checks from the repo root before finishing public-site work:

```powershell
node scripts/validate-static-site.mjs
node scripts/validate-site-shell.mjs
```

What they catch:

1. Missing required public files
2. Broken internal links and references
3. Shared header/footer shell drift
4. Malformed script includes
5. Inline-style regressions on public pages
6. Asset version drift across pages
7. Missing core SEO metadata on public pages
8. Missing skip-link, `main-content`, single-`h1`, or image `alt` markers

## Deployment

The public site deploys to HostGator through `.github/workflows/deploy.yml` on pushes to `main`.

The workflow now treats validation as the standing reviewer:

1. Validate required site files and internal references
2. Validate shared shell consistency
3. Validate FTP settings
4. Deploy via FTP/FTPS/SFTP based on repo configuration

`assets/site-config.js` must point at the correct live submission endpoint before contact or support form handling is enabled in production.

## Change Logging

Use both logs intentionally:

1. `CHANGELOG.md` for concise release notes
2. `docs/changes_summary.md` for narrative context and major site history

If a change affects site-wide styling, shared shell structure, deployment behavior, automation, or governance, update both.

## License

MIT. See `LICENSE`.


