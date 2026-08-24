# taggie-cli

[![npm version](https://img.shields.io/npm/v/taggie-cli.svg)](https://www.npmjs.com/package/taggie-cli)
[![npm downloads](https://img.shields.io/npm/dm/taggie-cli.svg)](https://www.npmjs.com/package/taggie-cli)
[![license](https://img.shields.io/npm/l/taggie-cli.svg)](https://github.com/nerds-lab-chapter-26/taggie-cli/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/taggie-cli.svg)](https://www.npmjs.com/package/taggie-cli)

**Safely add and manage project attribution across your codebase.**  
Interactive · CI · AI Agents

It's a small, local-first developer utility — no backend, no account, no dashboard. Everything happens on your filesystem, in one command.

## Demo

<img width="640" height="360" alt="demo" src="https://github.com/user-attachments/assets/d923fd62-81e3-49b8-9ebf-5a7779fe92c2" />

## Quick start

```bash
npm install -g taggie-cli
cd my-project
taggie
```

That's it — taggie detects your stack, finds (or creates) the footer, and adds the attribution.

For scripts and CI, skip the prompts:

```bash
taggie --yes --for "Acme Org" --emoji "🔥" --output app   # non-interactive: auto-detect + inject/create + wire
taggie --check                                             # read-only compliance check, meaningful exit code
```

## What taggie does

```text
Generate   an interactive "Made with ___ for ___" tagline
Add        inject it into your app's real, rendered footer (not just a README)
Check      report attribution status - read-only, CI-friendly
Sync       bring a project into compliance with a config-defined standard, idempotently
Update     re-run any of the above; taggie replaces its own output, never duplicates it
Remove     strip taggie's attribution safely, without touching your code around it
```

## Why Taggie?

Manually keeping attribution consistent across projects — and frameworks — is repetitive and easy to get wrong: hand-editing a footer, forgetting to update it everywhere it changed, and having no reliable way to check it's still correct.

Taggie automates that safely:

- Detects your project's stack (Next.js, React, Vue, Svelte, plain HTML)
- Finds the right place for the footer, or creates one if none exists
- Updates only the block it owns — never touches unrelated code
- Verifies compliance in CI (`--check`), with a meaningful exit code
- Synchronizes the same standard across multiple projects (`--sync`)
- Supports project config and named profiles instead of repeated flags
- Can be run by a coding agent instead of you typing commands

## Safe by design

- Refuses unsafe modifications instead of guessing
- Only ever modifies its own marked block — never a whole file or component
- Never blindly overwrites source files
- `--check` is always read-only
- `--dry-run` previews changes without writing anything
- CI-ready: meaningful exit codes, non-interactive flags, idempotent `--sync`

See [Safety](#safety) below for the full guarantees.

## Installation

[**taggie-cli on npm →**](https://www.npmjs.com/package/taggie-cli)

```bash
npm install -g taggie-cli   # or: npx taggie-cli ...
```

### Local use (without publishing)

```bash
npm link        # one-time - creates the global "taggie" command
taggie          # interactive mode - asks questions
```

To remove the link: `npm unlink -g taggie-cli`

## Interactive mode

```bash
taggie
```

It will ask:
1. Any emoji, shortcode, or word (❤️ `:fire:` rocket 🌟 or whatever you like) — taggie translates it into a word for the tagline
2. Who it's made for (company/team/project)
3. Style (`Made with love for X` / `Made with love by Y for X` / `Crafted with love by Y for X`)
4. Where the result should go — straight into your app's footer, FOOTER.md, README.md, or just the terminal

Any question already answered by a CLI flag or `taggie.config.json` (see below) is skipped.

## Injecting into your app's footer

taggie detects your stack from `package.json` and looks in the right kind of file:

| Stack | Where it looks | If nothing is found |
|---|---|---|
| Next.js | any `.jsx`/`.tsx`/`.js`/`.ts` file with a `<footer>` tag (e.g. `app/layout.tsx`) | creates `app/components/Footer.tsx` (or `.jsx`) |
| React | any `.jsx`/`.tsx`/`.js`/`.ts` file with a `<footer>` tag (e.g. `src/App.jsx`) | creates `src/components/Footer.jsx` (or `.tsx`) |
| Vue | any `.vue` file with a `<footer>` tag | creates `src/components/Footer.vue` |
| Svelte | any `.svelte` file with a `<footer>` tag | creates `src/lib/Footer.svelte` |
| Plain HTML | any `.html` file — creates a `<footer>` before `</body>` if none exists | asks for a path |

Re-running taggie updates the same tagline in place instead of duplicating it, so it's safe to run again.

When taggie creates a brand new Footer component, it also automatically wires it into your app's root file — no manual import/render step needed:

| Stack | Root file it wires into |
|---|---|
| Next.js | `app/layout.tsx` (or `.jsx`/`.ts`/`.js`), falling back to `pages/_app.tsx` |
| React | `src/App.tsx` (or `.jsx`/`.js`) |
| Vue | `src/App.vue` |
| Svelte | `src/routes/+layout.svelte` or `src/App.svelte` |

If none of those exist, taggie falls back to printing manual import/render instructions instead of guessing at an unfamiliar file.

Every footer taggie creates from scratch is centered and theme-aware (text color adapts to `prefers-color-scheme`, background stays transparent so it blends into your actual page). This only applies to footers taggie creates itself — it never touches the styling of a `<footer>` that already existed.

```bash
taggie --yes --for "Acme Org" --emoji "🔥" --output src/components/Footer.jsx
```

## Checking attribution status

```bash
taggie --check
```

Read-only - never modifies your project. Reports the detected framework, where the footer lives, the current attribution, and whether it's up to date. Exit code reflects compliance (`0` = up to date, non-zero = missing/outdated/no supported framework), so it's safe to use as a CI gate.

```text
Taggie Project Check

✓ Framework: Next.js
✓ Project root: /path/to/project
✓ Footer: app/layout.tsx
✓ Taggie attribution: Found
✓ Attribution: Made with ❤️ by 2Nerds
✓ Status: Up to date
```

If a `taggie.config.json` is present, "up to date" means the live attribution matches what the config would generate — not just that *some* attribution exists.

## Configuration (`taggie.config.json`)

Optional. Define your project's standard attribution once instead of passing the same flags every time:

```json
{
  "by": "2Nerds",
  "for": "Acme",
  "emoji": "❤️",
  "template": "byline"
}
```

Nothing requires this file — every existing `taggie`/`--yes` usage keeps working exactly as before without one.

**Precedence** (highest to lowest):

```text
Explicit CLI arguments
        ↓
Selected profile (--profile <name>)
        ↓
taggie.config.json (base fields)
        ↓
Interactive prompts/defaults
```

A CLI override (e.g. `--sync --by "Temporary Team"`) is used for that run only — it never rewrites `taggie.config.json`.

If `taggie.config.json` exists but isn't valid JSON, taggie refuses to guess what you meant — it prints the parse error and exits non-zero instead of silently ignoring the file (applies to the interactive/generate flow, `--check`, and `--sync`). In a multi-project `--sync`, a malformed config in one target only skips that target; the rest still run.

Selecting a profile that doesn't exist in the config (`--profile typo`) isn't an error — it silently falls back to the base config fields, same as not passing `--profile` at all.

### Profiles

Optional, on top of the base config:

```json
{
  "by": "2Nerds",
  "emoji": "❤️",
  "template": "byline",
  "profiles": {
    "opensource": { "by": "2Nerds Open Source", "emoji": "🚀" }
  },
  "defaultProfile": "default"
}
```

```bash
taggie --sync --profile opensource
```

A profile's fields override the base config's; anything a profile doesn't set falls back to the base. If you don't need profiles, `taggie.config.json` behaves exactly like a flat config file — no added complexity.

## Sync

```bash
taggie --sync
```

Brings the current project into compliance with the desired attribution (from config/profile/CLI flags): adds it if missing, updates it in place if outdated, and does nothing if it's already correct. Fully non-interactive — safe for scripts and CI, and idempotent (running it repeatedly converges to one correct attribution, never duplicates).

```text
Taggie Sync

✓ Framework: React
✓ Footer: src/App.jsx
✓ Attribution added
✓ Status: synchronized
```

```text
Taggie Sync

✓ Framework: React
✓ Attribution already up to date
✓ No changes needed
```

If taggie can't safely modify the project (no supported file to target), it reports exactly why and makes no changes:

```text
Taggie Sync

✗ Could not safely modify src/App.jsx.
No changes were made.
```

`--sync --dry-run` reports what *would* happen (add/update/no-op) without writing anything — useful to preview a sync, or in CI to fail if the project isn't already in sync without actually changing it.

### Multi-project sync

```bash
taggie --sync ./projects/*
```

Each target directory is synced independently, with its own `taggie.config.json` if present. A failure in one project (bad path, missing config, unsafe write) is reported and skipped — it never blocks or corrupts the others, and taggie never touches anything outside the directories you pass.

```text
Taggie Multi-Project Sync

✓ Project A       updated
✓ Project B       already up to date
✓ Project C       added
⚠ Project D       skipped: unsupported structure

3 successful
1 skipped
```

## Removing the tagline

```bash
taggie --remove                       # scans the whole project and cleans up everywhere taggie has written
taggie --remove --output FOOTER.md    # or target one file
taggie --remove --dry-run             # preview what would be removed, without writing anything
```

Removal only ever strips taggie's own marker block. It never deletes a Footer component file or un-wires its `<Footer />` import/render, since those may have been customized by hand after taggie created them — the one exception is an empty `FOOTER.md`, which is deleted outright since taggie owns that file's entire purpose.

## Non-interactive (for scripts/CI)

```bash
taggie --yes --for "Acme Org" --emoji "❤️" --template simple
taggie --yes --for "Acme Org" --by "Maryam" --template byline --output FOOTER.md
taggie --yes --for "Acme Org" --emoji "🔥" --output app   # auto-detect + inject/create + wire, no prompts
taggie --sync                                             # same idea, driven by taggie.config.json instead of flags
taggie --check                                             # read-only compliance check, no prompts, meaningful exit code
```

### CI example (GitHub Actions)

```yaml
name: Taggie Check

on:
  pull_request:

jobs:
  attribution:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npx taggie-cli --check
```

## Let a coding agent run taggie for you

Instead of typing `taggie` yourself, install agent integration once and just ask your agent to "add a footer," "check attribution," or "sync attribution" — it runs taggie on your behalf and reports what happened.

```bash
taggie --init-skill
```

It asks which agent you use:

| Choice | What it installs |
|---|---|
| Claude Code | `.claude/skills/taggie/SKILL.md` — a [Claude Code](https://claude.com/claude-code) skill |
| Other (Codex, Cursor, Aider, etc.) | a `## taggie` section in `AGENTS.md` — the cross-tool convention most other coding agents read |
| Both | both of the above |

Skip the prompt with `--agent claude`, `--agent agents`, or `--agent both` (required if you also pass `--yes`). Both are project-scoped by default; copy `.claude/skills/taggie/SKILL.md` to `~/.claude/skills/taggie/SKILL.md` to make the Claude Code skill available in every project instead. Re-running `--init-skill` updates its section in place rather than duplicating it.

Both the skill and the `AGENTS.md` section point agents at the full lifecycle (`--check`, `--sync`, `--remove`, config awareness) and tell them to prefer taggie over hand-editing a taggie-managed marker block.

## Framework support

Next.js, React, Vue, Svelte, and plain HTML — see [Injecting into your app's footer](#injecting-into-your-apps-footer) above for how each is detected and where a new footer gets created.

## Safety

- Never overwrites source files blindly — if there's no safe place to insert or update a footer, taggie refuses and reports why, rather than guessing.
- Never removes content it doesn't own: `--remove` only strips its own marked block, never a whole Footer component or its wiring.
- Never modifies anything outside the project root (or, in multi-project `--sync`, outside the specific target directory it's currently on).
- `--check` is always read-only.
- The taggie marker (`<!-- taggie -->...<!-- /taggie -->` or `{/* taggie */}...{/* /taggie */}`) is the single source of truth for what taggie manages — only content inside those markers is ever automatically updated or removed.

## Examples

```bash
taggie                                                        # interactive
taggie --yes --for "Acme Org" --emoji "❤️"                    # non-interactive, console output
taggie --yes --for "Acme Org" --emoji "🔥" --output app       # auto-detect + inject/create + wire
taggie --check                                                # read-only status
taggie --sync                                                 # idempotent add/update from config
taggie --sync --profile opensource                            # use a named profile
taggie --sync ./projects/*                                    # sync multiple projects
taggie --sync --dry-run                                       # preview a sync without writing
taggie --remove                                                # remove attribution
taggie --remove --dry-run                                      # preview a removal without writing
taggie --init-skill                                            # install agent integration
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the version history, or the [Releases](https://github.com/nerds-lab-chapter-26/taggie-cli/releases) page.

## Running tests

```bash
npm test
```

Uses Node's built-in test runner (`node --test`) — no extra dev dependencies needed.

## Publishing to npm (so `npx taggie-cli` works from anywhere)

```bash
npm login
npm publish
```

> The name "taggie" was already taken on npm (an unrelated redis package), so this package is named `taggie-cli` — the command itself is still `taggie`. You can rename it in `package.json` before publishing if you'd like.

## Support Taggie

If Taggie is useful to you:

- ⭐ Star the repository
- 🐛 Open an issue when something breaks
- 💡 Suggest improvements
- 🤝 Contribute

---

Made with ❤️ by 2Nerds
