# Changelog

All notable changes to `taggie-cli` are documented here. Versions match what's published on [npm](https://www.npmjs.com/package/taggie-cli?activeTab=versions).

## 0.2.7

- Moved the repository, homepage, and issues links to the Nerds Lab GitHub organization, so the npm page points at the right place.
- Refreshed the README with an animated demo, updated badges, and Nerds Lab branding.
- Added CONTRIBUTING.md.
- Fixed `npm test` failing on newer Node versions.

## 0.2.4

- README's own attribution line now shows the emoji glyph (`Made with ❤️ by 2Nerds`) instead of the spelled-out word, matching taggie's own convention.
- Added npm badges (version, downloads, license, node engine) and a direct npm link to the README.
- Linked the GitHub repository into `package.json` (`repository`/`homepage`/`bugs`).

## 0.2.1

- Added `--dry-run`, usable with `--sync` (single and multi-project) and `--remove` — reports what would change without writing anything.

## 0.2.0

- **Evolved from a tagline generator into a project attribution manager:**
  - `taggie --check` — read-only status report (framework, footer location, current attribution, compliance), CI-friendly exit codes.
  - `taggie.config.json` — optional project-level standard attribution, with clear precedence (CLI args > profile > config > interactive defaults).
  - Profiles (`--profile <name>`) on top of the base config.
  - `taggie --sync` — idempotent, non-interactive add/update against the config/profile/CLI-resolved attribution.
  - `taggie --sync <dir> <dir> ...` — multi-project sync; each target is independent, one failure never blocks or corrupts the others.
  - Agent integration (skill/AGENTS.md) updated to cover the full check/sync/remove lifecycle.
- Fixed: the `crafted` template was silently dropping the "for" value even though the CLI always asks for it.
- Fixed: the actual emoji glyph now appears in the tagline (in place of the spelled-out word), not just the word.

## 0.1.15

- `crafted` template now includes `for` (`Crafted with X by A for Y`).
- Emoji glyph substitutes for the spelled-out word in the generated line.

## 0.1.14

- Footers taggie creates from scratch are centered and theme-aware (`prefers-color-scheme: dark` support), without touching the styling of any footer that already existed.

## 0.1.12

- Added `--remove` — strips taggie's own marker block only; never deletes a Footer component file or un-wires its import/render. An empty `FOOTER.md` is deleted outright since taggie owns its entire purpose.

## 0.1.11

- New Footer components are now automatically wired into the app's root file (import + render) — no manual step required.
- Added `--init-skill` — installs a Claude Code skill and/or an `AGENTS.md` section so a coding agent can run taggie on the user's behalf.

## 0.1.8

- `injectIntoFile` refuses to write when there's no safe insertion point, instead of silently appending markup outside the render tree where it would never show up.
- Added a hint when running taggie one directory above the actual app root (common when the real project is nested one level deeper).

## 0.1.7

- Fixed a bug where the installed `taggie` command did nothing at all when run via `npm link` (or any symlinked install) — `import.meta.url` is symlink-resolved by Node's ESM loader but `process.argv[1]` isn't, so the "is this the entry module" check needed to resolve both sides consistently.

## 0.1.5

- Added stack-aware footer detection and creation for Next.js, React, Vue, Svelte, and plain HTML — each framework is scanned for the right kind of file instead of only ever looking for `.html`.

## 0.1.0 – 0.1.3

- Initial releases: interactive tagline generator, emoji/shortcode/word translation, multiple templates, output to console/`FOOTER.md`/`README.md`/the app's footer, basic HTML footer injection.
