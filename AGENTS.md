# Joyful Innovation Agent Instructions

These instructions apply to the entire repository.

## Start Here

Before making structural, visual, deployment, or documentation changes, read these files in order:

1. `README.md`
2. `docs/site-standards.md`
3. `CHANGELOG.md`
4. `docs/changes_summary.md`

## Repo Boundaries

- The repository root is the public Joyful Innovation marketing site.
- `deploy/reploy-stack/` is a separate operational application with its own runtime, README, and deployment concerns.
- Do not mix public-site conventions with `deploy/reploy-stack/` conventions unless the task explicitly spans both surfaces.

## Public Site Sources Of Truth

- `assets/styles.css` is the source of truth for public-site layout, spacing, colors, typography, header, footer, and component styling.
- `index.html` is the source of truth for the shared public header and footer shell.
- `assets/site.js` is the shared behavior layer for the public site.
- `assets/data/resources-data.js` and `assets/data/support-data.js` are the content sources for data-driven listing pages.

## Non-Negotiable Public Site Rules

- Keep the public header shell consistent across all non-redirect public pages.
- Keep the public footer shell consistent across all non-redirect public pages.
- Do not introduce alternate header/footer variants on marketing pages or blog pages.
- Do not add inline `style=` attributes to public pages. Put presentation in `assets/styles.css`.
- Do not add malformed script tags or ad hoc asset includes.
- If you change a shared asset file, bump its `?v=` query string on every page that references that asset.
- Preserve the current nav order and primary CTAs unless the task explicitly changes site navigation.

## Required Validation Before Finishing

Run all three validators from the repo root:

1. `node scripts/validate-static-site.mjs`
2. `node scripts/validate-site-shell.mjs`
3. `node scripts/validate-repo-governance.mjs`

If any validator fails, fix the root cause instead of bypassing the check.

## Required Documentation Updates

Update `CHANGELOG.md` for any user-visible, deploy, security, structural, or workflow change.

Update `docs/changes_summary.md` when the change affects one of these areas:

- site-wide design
- shared shell structure
- deployment behavior
- governance/process
- validation/automation

## Definition Of Done

A public-site task is not complete until:

1. The affected pages use the shared shell correctly.
2. Shared assets and version strings are aligned.
3. Both validators pass.
4. The changelog is updated.
5. The narrative summary is updated for multi-file or structural work.