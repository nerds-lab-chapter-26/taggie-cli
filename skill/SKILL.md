---
name: taggie
description: Manages project attribution ("Made with [word] for ___" footers/taglines) using the taggie CLI - inspects, adds, synchronizes, and removes attribution safely, auto-detecting the stack (Next.js/React/Vue/Svelte/plain HTML) and wiring newly created Footer components in automatically. Use when the user asks to add, check, sync, update, or remove a footer, tagline, "made with love" credit, or attribution line in their project.
---

# taggie

Runs the `taggie` CLI on the user's behalf instead of asking them to type it themselves or hand-editing footer markup. taggie manages a project's attribution end-to-end (inspect, add, synchronize, remove) - **prefer it over manually editing a taggie-managed marker block** (`<!-- taggie -->...<!-- /taggie -->` or `{/* taggie */}...{/* /taggie */}`) whenever the project is compatible; only fall back to manual edits when taggie itself refuses (it will say so explicitly).

## When to use this

- Adding attribution: "add a footer", "add a made with love credit", "tagline for this project", "attribution footer".
- Checking status: "does this project have attribution", "is the footer up to date", "audit the footer".
- Syncing to a standard: "make sure attribution matches our config/standard", "fix the footer to match `taggie.config.json`".
- Removing: "remove the footer/tagline/attribution credit".

## Step 1: Check first if unsure

If you don't already know whether the project has attribution (or what it currently says), run:

```bash
taggie --check
```

Read-only, never modifies anything, and its exit code tells you compliance (0 = up to date, non-zero = missing/outdated/no supported framework). Its output tells you the framework, footer location, current attribution, and status - use this instead of grepping for markers yourself.

## Step 2: Gather the inputs (for adding/updating)

- **for** (required unless a `taggie.config.json` already supplies it) - who it's for: company/team/project name. Infer from the repo (package.json `name`, org name mentioned in the conversation) if not stated; otherwise ask.
- **emoji** (optional, defaults to ❤️) - any emoji, `:shortcode:`, or plain word (fire, rocket, sparkles, ...). Take literally what the user says; don't overthink it.
- **template** (optional, defaults to `simple`) - one of:
  - `simple` → "Made with X for Y"
  - `byline` → "Made with X by A for Y" (needs **by**)
  - `crafted` → "Crafted with X by A for Y" (needs **by**)
- **by** (required only for `byline`/`crafted`) - author/team name. If the user wants a byline-style credit but hasn't named an author, ask - don't guess a name.

Don't over-ask: if the user just says "add a footer for Acme", run with `--for "Acme"` and the simple template. Only ask about style/author if they hint at wanting one (e.g. "credit our team") without naming it.

If the project has a `taggie.config.json`, prefer letting it supply the values (see below) instead of passing everything via flags.

## Step 3: Run the CLI

If the project has (or should have) a `taggie.config.json` defining its standard attribution, use `--sync` - it's idempotent and non-interactive by design, reads the config, and reports exactly what it did:

```bash
taggie --sync                              # bring the project into compliance with config/CLI-supplied values
taggie --sync --profile <name>             # use a named profile from taggie.config.json
taggie --sync ./projects/*                 # sync several project directories independently
```

Otherwise, for a one-off add/update without a config file:

```bash
taggie --yes --output app --for "<for>" [--emoji "<emoji>"] [--template <template>] [--by "<by>"]
```

Prefer the globally installed `taggie` command; fall back to `npx taggie-cli ...` if it's not on PATH. `--output app` (used by both `--sync` and the plain generate flow) is the key behavior - it auto-detects the project's stack and either injects into an existing `<footer>` or creates a brand new Footer component **and wires it into the app's root file automatically** (`app/layout.tsx` for Next.js, `src/App.jsx` for React, etc.). No manual import/render step needed.

Run it from the project root (the directory with the `package.json` that lists the framework). If you're not sure that's the current directory, check for `package.json` first.

## Step 4: Handle the result

taggie prints one of these outcomes - relay the relevant part to the user in plain language, don't just paste raw CLI output:

- `"...created <file> and wired it into <rootFile>."` / sync's `"Attribution added"` → fully done, nothing left for the user to do.
- `"Inserted into footer: <file>"` / sync's `"Attribution updated"` → updated an existing footer in place (safe to re-run - taggie replaces its own previous output instead of duplicating it).
- Sync's `"Attribution already up to date" / "No changes needed"` → nothing to do, the project already matches.
- `"No framework detected here, but found <Stack> in ./<dir> - run taggie from inside that folder..."` → the command was run one directory above the real app. `cd` into that folder and retry there.
- A non-zero exit with an error message (e.g. "No footer file found and no framework detected...", "--by is required...", "Couldn't find a safe place to insert the footer...", sync's "Could not safely modify the project.") → don't guess around it or hand-edit the file yourself; report the exact error to the user and ask how they want to proceed (e.g. point at a specific file with `--output <file>` instead of `app`).

## Removing attribution

```bash
taggie --remove                       # scans the whole project
taggie --remove --output <file>       # or target one file
```

This only strips taggie's own marked block - it won't delete a Footer component file or its `<Footer />` wiring, since those may have been hand-edited since taggie created them.

## Configuration (`taggie.config.json`)

A project can define its standard attribution once instead of passing flags every time:

```json
{
  "by": "Nerds Lab",
  "for": "Acme",
  "emoji": "❤️",
  "template": "byline",
  "profiles": {
    "opensource": { "by": "Nerds Lab Open Source", "emoji": "🚀" }
  },
  "defaultProfile": "default"
}
```

Precedence: explicit CLI arguments > selected profile (`--profile <name>`) > base `taggie.config.json` fields > interactive prompts/defaults. `--check` and `--sync` both read this file automatically - you don't need to pass `--for`/`--by`/etc. again if it's already there. A CLI override (e.g. `--sync --by "Temporary Team"`) does not rewrite the config file - only pass `--profile`/flags, never edit `taggie.config.json` yourself unless the user explicitly asks you to change the project's standard attribution.

## Notes

- Re-running `--sync` (or the plain generate flow) is safe and idempotent: taggie replaces its own previously-inserted block instead of duplicating it.
- This skill only runs the CLI - it doesn't reimplement any of taggie's detection/injection/check/sync logic. If the CLI's behavior seems wrong, that's a taggie-cli bug, not something to work around by hand-editing files or the marker blocks it manages.
