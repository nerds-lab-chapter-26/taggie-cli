#!/usr/bin/env node
import { Command } from "commander";
import prompts from "prompts";
import chalk from "chalk";
import * as emojiLib from "node-emoji";
import { promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const WORD_OVERRIDES = {
  heart: "love",
  blue_heart: "love",
  green_heart: "love",
  yellow_heart: "love",
  purple_heart: "love",
  orange_heart: "love",
  black_heart: "love",
  white_heart: "love",
  brown_heart: "love",
  sparkling_heart: "love",
  two_hearts: "love",
  heartpulse: "love",
  heartbeat: "love",
  revolving_hearts: "love",
  cupid: "love",
  gift_heart: "love",
  sparkles: "magic",
  star2: "magic",
  dizzy: "magic",
};

// Accepts a real emoji character, a :shortcode:, or a plain word - and
// translates it into the word used in the tagline text.
export function translateEmoji(input) {
  const trimmed = (input ?? "").trim();
  const found = emojiLib.find(trimmed);
  if (found) {
    return WORD_OVERRIDES[found.key] ?? found.key.replace(/_/g, " ");
  }
  // not a recognized emoji/shortcode - treat input as an already-typed word
  return trimmed.replace(/^:|:$/g, "") || "love";
}

// Looks up the actual emoji character for the input, regardless of
// whether it was typed as a unicode glyph, a :shortcode:, or a plain
// word ("fire" and 🔥 both resolve to the same glyph via node-emoji) -
// so the rendered tagline can show the symbol next to its translated
// word instead of just the text.
export function emojiGlyph(input) {
  const found = emojiLib.find((input ?? "").trim());
  return found ? found.emoji : null;
}

export const TEMPLATES = {
  simple: ({ word, forWhom }) => `Made with ${word} for ${forWhom}`,
  byline: ({ word, forWhom, by }) =>
    `Made with ${word} by ${by} for ${forWhom}`,
  crafted: ({ word, forWhom, by }) =>
    `Crafted with ${word} by ${by} for ${forWhom}`,
};

function banner() {
  console.log();
  console.log(chalk.bold.magenta("  🏷️  taggie"));
  console.log(chalk.dim("  tagline / footer generator\n"));
}

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
  "coverage",
  ".svelte-kit",
  "out",
]);

const STACK_LABELS = {
  next: "Next.js",
  react: "React",
  vue: "Vue",
  svelte: "Svelte",
  static: "HTML",
};

// Only scan source-code extensions relevant to the detected stack - a
// framework's index.html shell (React/Vue/Svelte) never shows the
// rendered footer, so it's deliberately excluded for those stacks.
const STACK_EXTENSIONS = {
  next: ["jsx", "tsx", "js", "ts"],
  react: ["jsx", "tsx", "js", "ts"],
  vue: ["vue"],
  svelte: ["svelte"],
  static: ["html"],
};

const JSX_COMMENT_EXT = new Set(["jsx", "tsx", "js", "ts"]);

const MARKER_RE =
  /(<!--\s*taggie\s*-->|\{\/\*\s*taggie\s*\*\/\})[\s\S]*?(<!--\s*\/taggie\s*-->|\{\/\*\s*\/taggie\s*\*\/\})/i;

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function stackFromDeps(pkg) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.next) return "next";
  if (deps.vue || deps.nuxt) return "vue";
  if (deps.svelte || deps["@sveltejs/kit"]) return "svelte";
  if (deps.react) return "react";
  return null;
}

// Detects the project's frontend stack from package.json so taggie can
// look in the right kind of file for the footer (jsx/tsx for React and
// Next.js, .vue for Vue, .svelte for Svelte, plain .html otherwise).
export async function detectStack() {
  let pkg;
  try {
    pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
  } catch {
    return { stack: "static", useTypeScript: false };
  }
  const useTypeScript = await pathExists("tsconfig.json");
  const stack = stackFromDeps(pkg);
  return { stack: stack ?? "static", useTypeScript };
}

// When the current directory has no recognized frontend framework, check
// one level of subdirectories for one - catches the common mistake of
// running taggie one folder above the actual app root (e.g. a wrapper
// folder that only has taggie-cli itself as a dependency).
export async function findNestedFrameworkHint(dir = ".") {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || IGNORE_DIRS.has(entry.name))
      continue;
    const pkgPath =
      dir === "." ? `${entry.name}/package.json` : `${dir}/${entry.name}/package.json`;
    let pkg;
    try {
      pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
    } catch {
      continue;
    }
    const stack = stackFromDeps(pkg);
    if (stack) return { dir: entry.name, stack };
  }
  return null;
}

async function scanForFiles(extensions, dir, depth, maxDepth, results) {
  if (depth > maxDepth) return results;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const rel = dir === "." ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || IGNORE_DIRS.has(entry.name)) continue;
      await scanForFiles(extensions, rel, depth + 1, maxDepth, results);
    } else {
      const ext = entry.name.split(".").pop().toLowerCase();
      if (extensions.includes(ext)) results.push(rel);
    }
  }
  return results;
}

function byShallowestPath(a, b) {
  return a.split("/").length - b.split("/").length || a.localeCompare(b);
}

function isFooterNamed(file) {
  return /(^|\/)footer\.[a-z]+$/i.test(file);
}

// Finds the best file(s) to hold the tagline for the detected stack.
// - static (plain HTML): every .html file is a valid target, since the
//   </body> fallback can always create a <footer> safely.
// - frameworks: only files that already have a <footer> tag or taggie
//   markers qualify (safest), falling back to a file literally named
//   Footer.* if nothing else matches. If nothing qualifies at all, the
//   caller creates a brand new Footer component instead of guessing.
export async function findCandidates(stackInfo) {
  const extensions = STACK_EXTENSIONS[stackInfo.stack];

  if (stackInfo.stack === "static") {
    const files = await scanForFiles(extensions, ".", 0, 4, []);
    files.sort(byShallowestPath);
    return files;
  }

  const files = await scanForFiles(extensions, ".", 0, 5, []);
  const withFooter = [];
  const footerNamedOnly = [];

  for (const file of files) {
    let content;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    // Case-sensitive on purpose: a lowercase <footer> is the real HTML
    // element, but a capitalized <Footer /> is a reference to a React
    // component of that name (e.g. our own wired-in <Footer />) and must
    // not be mistaken for an existing footer element.
    if (MARKER_RE.test(content) || /<footer[\s>]/.test(content)) {
      withFooter.push(file);
    } else if (isFooterNamed(file)) {
      footerNamedOnly.push(file);
    }
  }

  withFooter.sort(byShallowestPath);
  footerNamedOnly.sort(byShallowestPath);
  return withFooter.length > 0 ? withFooter : footerNamedOnly;
}

async function ask(options) {
  const questions = [];

  if (!options.emoji) {
    questions.push({
      type: "text",
      name: "emoji",
      message: "Type any emoji (taggie will translate it):",
      initial: "❤️",
    });
  }

  if (!options.forWhom) {
    questions.push({
      type: "text",
      name: "forWhom",
      message: "Who is this for? (e.g. company, team, project)",
      validate: (v) => (v.trim().length > 0 ? true : "This field is required"),
    });
  }

  // A template already resolved from --template or config/profile skips
  // this question entirely (CLI/config precedence takes priority over
  // the interactive prompt), same as emoji/forWhom above.
  if (!options.template) {
    questions.push({
      type: "select",
      name: "template",
      message: "Which style do you like?",
      choices: [
        { title: "Made with love for X", value: "simple" },
        { title: "Made with love by Y for X", value: "byline" },
        { title: "Crafted with love by Y for X", value: "crafted" },
      ],
      initial: 0,
    });
  }

  questions.push({
    // The template question may have been skipped (already resolved),
    // so its answer isn't reliably available via `prev`/`values.template`
    // - fall back to the pre-resolved options.template in that case.
    type: (prev, values) =>
      !options.by && (options.template ?? values.template) !== "simple" ? "text" : null,
    name: "by",
    message: "What's the name? (author/team)",
    validate: (v) => (v.trim().length > 0 ? true : "This field is required"),
  });

  const stackInfo = await detectStack();
  const candidates = await findCandidates(stackInfo);
  const willCreateNew = candidates.length === 0 && stackInfo.stack !== "static";

  if (stackInfo.stack !== "static") {
    console.log(chalk.dim(`  Detected stack: ${STACK_LABELS[stackInfo.stack]}`));
  } else {
    const nested = await findNestedFrameworkHint();
    if (nested) {
      console.log(
        chalk.yellow(
          `  No framework detected here, but found ${STACK_LABELS[nested.stack]} in ./${nested.dir} - run taggie from inside that folder for auto-detection.`
        )
      );
    }
  }

  const primaryLabel = willCreateNew
    ? `Create a Footer component (${STACK_LABELS[stackInfo.stack]})`
    : stackInfo.stack === "static"
      ? "Insert into an HTML file's footer"
      : `Insert into the footer (${STACK_LABELS[stackInfo.stack]} detected)`;

  questions.push({
    type: "select",
    name: "output",
    message: "Where should the result go?",
    choices: [
      { title: primaryLabel, value: "app" },
      { title: "Save to FOOTER.md", value: "footer" },
      { title: "Append to README.md", value: "readme" },
      { title: "Just show it in the terminal", value: "console" },
    ],
    initial: 0,
  });

  // Only ask which file when there's more than one candidate - a single
  // match is used automatically, and a brand new component needs no path.
  questions.push({
    type: (prev) => (prev === "app" && candidates.length > 1 ? "select" : null),
    name: "targetFile",
    message: "Which file?",
    choices: () => [
      ...candidates.map((f) => ({ title: f, value: f })),
      { title: "Enter path manually...", value: "__custom__" },
    ],
  });

  questions.push({
    type: (prev, values) =>
      values.output === "app" &&
      !willCreateNew &&
      (candidates.length === 0 || values.targetFile === "__custom__")
        ? "text"
        : null,
    name: "targetFileCustom",
    message:
      candidates.length === 0
        ? "No file found - enter the path:"
        : "Enter the file path:",
  });

  const answers = await prompts(questions, {
    onCancel: () => {
      console.log(chalk.yellow("\nCancelled.\n"));
      process.exit(1);
    },
  });

  return { ...answers, stackInfo, candidates, willCreateNew };
}

export async function writeToMarkdown(file, line) {
  const block = `\n<!-- taggie -->\n${line}\n<!-- /taggie -->\n`;
  const markerRe = /<!-- taggie -->[\s\S]*?<!-- \/taggie -->/;
  try {
    const existing = await fs.readFile(file, "utf8");
    if (markerRe.test(existing)) {
      await fs.writeFile(file, existing.replace(markerRe, block.trim()));
    } else {
      await fs.writeFile(file, existing.trimEnd() + "\n" + block);
    }
  } catch {
    await fs.writeFile(file, block.trimStart());
  }
}

function markersFor(ext) {
  return JSX_COMMENT_EXT.has(ext)
    ? { start: "{/* taggie */}", end: "{/* /taggie */}" }
    : { start: "<!-- taggie -->", end: "<!-- /taggie -->" };
}

// Inserts (or replaces, if taggie already ran here) the tagline in a
// footer-related file. Works across HTML, JSX/TSX, Vue, and Svelte: if
// the file already has a <footer> tag, the line goes right inside it.
// Otherwise HTML gets a new <footer> before </body>, Vue gets one inside
// <template>, Svelte gets one appended at the top level (Svelte allows
// multiple root elements, so this always renders), and JSX/TSX/JS/TS
// gets the line dropped into its first returned element. If none of
// those anchors exist, this refuses to write rather than silently
// appending markup outside the render tree, where it would never show up.
export async function injectIntoFile(file, line) {
  let content;
  try {
    content = await fs.readFile(file, "utf8");
  } catch {
    console.error(chalk.red(`File not found: ${file}`));
    process.exit(1);
  }

  const ext = file.split(".").pop().toLowerCase();
  const { start, end } = markersFor(ext);
  const snippet = `${start}\n    <p>${line}</p>\n    ${end}`;

  if (MARKER_RE.test(content)) {
    content = content.replace(MARKER_RE, snippet);
  } else if (/<footer[^>]*>/.test(content)) {
    // Case-sensitive - see the matching note in findCandidates: this must
    // not match a capitalized <Footer /> component reference.
    content = content.replace(/(<footer[^>]*>)/, `$1\n    ${snippet}`);
  } else if (JSX_COMMENT_EXT.has(ext)) {
    const returnTagRe = /(return\s*\(?\s*<[a-zA-Z][^>]*>)/;
    if (!returnTagRe.test(content)) {
      console.error(
        chalk.red(
          `Couldn't find a safe place to insert the footer in ${file} (no <footer> tag and no JSX return statement found).`
        )
      );
      console.error(
        chalk.dim(
          "Point --output at a file with an existing <footer> tag, or skip --output/pick 'app' so taggie can create a new Footer component instead."
        )
      );
      process.exit(1);
    }
    content = content.replace(returnTagRe, `$1\n      ${snippet}`);
  } else if (ext === "vue") {
    if (!/<template[^>]*>/i.test(content)) {
      console.error(
        chalk.red(`Couldn't find a <template> block to insert the footer in ${file}.`)
      );
      process.exit(1);
    }
    content = content.replace(
      /(<template[^>]*>)/i,
      `$1\n  <footer class="${FOOTER_CLASS}">\n    ${snippet}\n  </footer>`
    );
    // Vue SFCs allow multiple <style> blocks, so appending one after
    // </template> is safe even if the file already has its own.
    content = content.replace(/<\/template>/i, `</template>\n\n<style scoped>\n${FOOTER_CSS_RULES}\n</style>`);
  } else if (ext === "svelte") {
    // Svelte components can have multiple root-level elements, so a
    // <footer> appended at the end of the file is part of the rendered
    // template - no return/wrapper tag needed.
    content += `\n<footer class="${FOOTER_CLASS}">\n  ${snippet}\n</footer>\n\n<style>\n${FOOTER_CSS_RULES}\n</style>\n`;
  } else if (ext === "html") {
    if (!/<\/body>/i.test(content)) {
      console.error(chalk.red(`Couldn't find </body> to insert the footer in ${file}.`));
      process.exit(1);
    }
    content = content.replace(
      /<\/body>/i,
      `  ${FOOTER_STYLE_TAG_HTML}\n  <footer class="${FOOTER_CLASS}">\n    ${snippet}\n  </footer>\n</body>`
    );
  } else {
    console.error(
      chalk.red(`Don't know how to insert a footer into a .${ext} file: ${file}`)
    );
    process.exit(1);
  }

  await fs.mkdir(path.dirname(file), { recursive: true }).catch(() => {});
  await fs.writeFile(file, content);
}

// Same marker pair as MARKER_RE, but also swallows the marker's leading
// indentation and one trailing newline so removal doesn't leave a blank
// line behind.
const REMOVE_BLOCK_RE =
  /[ \t]*(<!--\s*taggie\s*-->|\{\/\*\s*taggie\s*\*\/\})[\s\S]*?(<!--\s*\/taggie\s*-->|\{\/\*\s*\/taggie\s*\*\/\})[ \t]*\r?\n?/i;

const REMOVABLE_EXTENSIONS = ["html", "jsx", "tsx", "js", "ts", "vue", "svelte", "md"];

function isFooterMdFile(file) {
  return path.basename(file).toLowerCase() === "footer.md";
}

// Strips taggie's own marker block from a file. Deliberately narrow in
// scope: it only ever removes the exact block it previously inserted -
// never the surrounding <footer> tag, a whole component file, or its
// wiring in a root file - since those may have been customized by hand
// after taggie created them. FOOTER.md is the one exception: since
// taggie owns that file's entire purpose, an empty FOOTER.md is deleted
// outright instead of left behind as clutter.
export async function removeFromFile(file, { dryRun = false } = {}) {
  let content;
  try {
    content = await fs.readFile(file, "utf8");
  } catch {
    return { status: "not-found" };
  }
  if (!MARKER_RE.test(content)) {
    return { status: "no-marker" };
  }
  const stripped = content.replace(REMOVE_BLOCK_RE, "");
  const wouldDelete = isFooterMdFile(file) && stripped.trim() === "";

  if (dryRun) {
    return { status: wouldDelete ? "would-delete" : "would-remove" };
  }

  if (wouldDelete) {
    await fs.unlink(file);
    return { status: "deleted" };
  }

  await fs.writeFile(file, stripped);
  return { status: "removed" };
}

// Scans the project for every file still carrying a taggie marker block,
// so `--remove` without an explicit --output can clean up everywhere
// taggie has previously written, not just one file.
export async function findFilesWithMarker(dir = ".", depth = 0, maxDepth = 5, results = []) {
  if (depth > maxDepth) return results;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const rel = dir === "." ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || IGNORE_DIRS.has(entry.name)) continue;
      await findFilesWithMarker(rel, depth + 1, maxDepth, results);
      continue;
    }
    const ext = entry.name.split(".").pop().toLowerCase();
    if (!REMOVABLE_EXTENSIONS.includes(ext)) continue;
    let content;
    try {
      content = await fs.readFile(rel, "utf8");
    } catch {
      continue;
    }
    if (MARKER_RE.test(content)) results.push(rel);
  }
  results.sort(byShallowestPath);
  return results;
}

// Pulls the plain-text attribution line out of a taggie marker block,
// stripping the <p> wrapper used in code files (markdown files never had
// one - writeToMarkdown writes the line directly between markers).
export function extractAttributionLine(content) {
  const m = content.match(MARKER_RE);
  if (!m) return null;
  const whole = m[0];
  const inner = whole.slice(m[1].length, whole.length - m[2].length);
  return inner.replace(/<\/?p>/g, "").trim();
}

const SUPPORTED_FRAMEWORKS_LIST = ["Next.js", "React", "Vue", "Svelte", "Plain HTML"];

// Read-only project inspection: detects the framework, locates the
// footer (an existing taggie-marked file, or a file with a real <footer>
// tag/candidate that doesn't have attribution yet), and reports whether
// attribution exists and - when a desired line is supplied (e.g. derived
// from taggie.config.json) - whether it's up to date. Never writes
// anything.
export async function checkProject(expectedLine = null) {
  const stackInfo = await detectStack();
  const markedFiles = await findFilesWithMarker();
  const candidates = await findCandidates(stackInfo);
  const footerFile = markedFiles[0] ?? candidates[0] ?? null;
  const noFrameworkDetected = stackInfo.stack === "static" && !footerFile;

  let attribution = null;
  if (markedFiles[0]) {
    attribution = extractAttributionLine(await fs.readFile(markedFiles[0], "utf8"));
  }

  let upToDate = null;
  if (attribution !== null && expectedLine !== null) {
    upToDate = attribution === expectedLine;
  }

  return {
    noFrameworkDetected,
    stack: stackInfo.stack,
    frameworkLabel: STACK_LABELS[stackInfo.stack],
    projectRoot: process.cwd(),
    footerFile,
    hasAttribution: attribution !== null,
    attribution,
    upToDate,
  };
}

// A --check (or --sync's final verification) run is "compliant" only
// when attribution exists and, if a desired line was supplied, matches
// it exactly.
export function isCheckCompliant(report) {
  if (report.noFrameworkDetected) return false;
  if (!report.hasAttribution) return false;
  if (report.upToDate === false) return false;
  return true;
}

export function formatCheckReport(report) {
  const lines = ["Taggie Project Check", ""];

  if (report.noFrameworkDetected) {
    lines.push("⚠ No supported framework detected.", "");
    lines.push("Supported:");
    for (const name of SUPPORTED_FRAMEWORKS_LIST) lines.push(`- ${name}`);
    return lines.join("\n");
  }

  lines.push(`✓ Framework: ${report.frameworkLabel}`);
  lines.push(`✓ Project root: ${report.projectRoot}`);
  if (report.footerFile) {
    lines.push(`✓ Footer: ${report.footerFile}`);
  }

  if (report.hasAttribution) {
    lines.push(`✓ Taggie attribution: Found`);
    lines.push(`✓ Attribution: ${report.attribution}`);
    if (report.upToDate === false) {
      lines.push(`✗ Status: Outdated`);
      lines.push("");
      lines.push("Run `taggie --sync` to update it.");
    } else {
      lines.push(`✓ Status: Up to date`);
    }
  } else {
    lines.push(`✗ Taggie attribution: Not found`);
    lines.push("");
    lines.push("Run `taggie` or `taggie --sync` to add it.");
  }

  return lines.join("\n");
}

export function footerExt(stack, useTypeScript) {
  if (stack === "vue") return "vue";
  if (stack === "svelte") return "svelte";
  return useTypeScript ? "tsx" : "jsx";
}

export async function standaloneFooterPath(stack, useTypeScript) {
  const ext = footerExt(stack, useTypeScript);
  const hasSrc = await pathExists("src");
  const hasApp = await pathExists("app");

  if (stack === "next")
    return hasApp ? `app/components/Footer.${ext}` : `components/Footer.${ext}`;
  if (stack === "svelte")
    return hasSrc ? `src/lib/Footer.svelte` : `components/Footer.svelte`;
  if (stack === "vue")
    return hasSrc ? `src/components/Footer.vue` : `components/Footer.vue`;
  return hasSrc ? `src/components/Footer.${ext}` : `components/Footer.${ext}`;
}

// Centered, and theme-aware: text color adapts to prefers-color-scheme
// instead of a hardcoded value that could go invisible on a dark page.
// Background is left transparent on purpose - taggie doesn't know the
// app's real background color, so it inherits whatever is already there
// rather than guessing and clashing with it.
const FOOTER_CLASS = "taggie-footer";
const FOOTER_CSS_RULES = `.${FOOTER_CLASS} {\n  text-align: center;\n  padding: 1rem;\n  color: #111827;\n}\n@media (prefers-color-scheme: dark) {\n  .${FOOTER_CLASS} {\n    color: #e5e7eb;\n  }\n}`;
const FOOTER_STYLE_TAG_HTML = `<style>\n${FOOTER_CSS_RULES}\n</style>`;
const FOOTER_STYLE_TAG_JSX = `<style>{\`\n${FOOTER_CSS_RULES}\n\`}</style>`;

export function standaloneFooterContent(stack, line) {
  if (stack === "vue") {
    return `<template>\n  <footer class="${FOOTER_CLASS}">\n    <!-- taggie -->\n    <p>${line}</p>\n    <!-- /taggie -->\n  </footer>\n</template>\n\n<style scoped>\n${FOOTER_CSS_RULES}\n</style>\n`;
  }
  if (stack === "svelte") {
    return `<footer class="${FOOTER_CLASS}">\n  <!-- taggie -->\n  <p>${line}</p>\n  <!-- /taggie -->\n</footer>\n\n<style>\n${FOOTER_CSS_RULES}\n</style>\n`;
  }
  return `export default function Footer() {\n  return (\n    <footer className="${FOOTER_CLASS}">\n      {/* taggie */}\n      <p>${line}</p>\n      {/* /taggie */}\n      ${FOOTER_STYLE_TAG_JSX}\n    </footer>\n  );\n}\n`;
}

// Where each stack's top-level component lives, in priority order - this
// is what a new Footer component gets wired into automatically.
const ROOT_FILE_CANDIDATES = {
  next: [
    "app/layout.tsx",
    "app/layout.jsx",
    "app/layout.ts",
    "app/layout.js",
    "pages/_app.tsx",
    "pages/_app.jsx",
    "pages/_app.js",
  ],
  react: ["src/App.tsx", "src/App.jsx", "src/App.js", "App.tsx", "App.jsx", "App.js"],
  vue: ["src/App.vue", "App.vue"],
  svelte: [
    "src/routes/+layout.svelte",
    "src/App.svelte",
    "App.svelte",
  ],
};

export async function findRootFile(stack) {
  for (const candidate of ROOT_FILE_CANDIDATES[stack] ?? []) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

function relativeImportPath(fromFile, toFile) {
  let rel = path.relative(path.dirname(fromFile), toFile).split(path.sep).join("/");
  rel = rel.replace(/\.(tsx|jsx|ts|js|vue|svelte)$/, "");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

// Imports and renders the new Footer component inside the app's root
// file, so a freshly created footer actually shows up without the user
// having to wire it in by hand. Idempotent: if <Footer is already
// referenced, this is a no-op. Returns false (leaving the file
// untouched) if no safe insertion point is found.
export async function wireFooterIntoRoot(rootFile, footerFile) {
  let content;
  try {
    content = await fs.readFile(rootFile, "utf8");
  } catch {
    return false;
  }
  if (/<Footer[\s/>]/.test(content)) return true;

  const ext = rootFile.split(".").pop().toLowerCase();
  const importPath = relativeImportPath(rootFile, footerFile);
  const importLine = `import Footer from "${importPath}";`;

  if (JSX_COMMENT_EXT.has(ext)) {
    const lastImportRe = /(^import .*\n)+/m;
    content = lastImportRe.test(content)
      ? content.replace(lastImportRe, (m) => `${m}${importLine}\n`)
      : `${importLine}\n${content}`;

    if (content.includes("{children}")) {
      content = content.replace("{children}", "{children}\n        <Footer />");
    } else {
      const returnTagRe = /(return\s*\(?\s*<[a-zA-Z][^>]*>)/;
      if (!returnTagRe.test(content)) return false;
      content = content.replace(returnTagRe, `$1\n      <Footer />`);
    }
  } else if (ext === "vue") {
    content = /<script[^>]*>/i.test(content)
      ? content.replace(/(<script[^>]*>)/i, `$1\n${importLine}`)
      : `<script setup>\n${importLine}\n</script>\n\n${content}`;

    if (!/<\/template>/i.test(content)) return false;
    content = content.replace(/<\/template>/i, `  <Footer />\n</template>`);
  } else if (ext === "svelte") {
    content = /<script[^>]*>/i.test(content)
      ? content.replace(/(<script[^>]*>)/i, `$1\n${importLine}`)
      : `<script>\n${importLine}\n</script>\n\n${content}`;
    content += `\n<Footer />\n`;
  } else {
    return false;
  }

  await fs.writeFile(rootFile, content);
  return true;
}

// Creates a brand new Footer component for the detected stack and, when
// possible, wires it straight into the app's root file so it renders
// immediately - no manual import/render step required.
export async function createStandaloneFooter(stackInfo, line) {
  const file = await standaloneFooterPath(stackInfo.stack, stackInfo.useTypeScript);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, standaloneFooterContent(stackInfo.stack, line));

  const rootFile = await findRootFile(stackInfo.stack);
  const wired = rootFile ? await wireFooterIntoRoot(rootFile, file) : false;

  return { file, rootFile: wired ? rootFile : null };
}

// Copies the bundled Claude Code skill (skill/SKILL.md, shipped alongside
// this CLI) into the current project's .claude/skills/taggie/, so a
// coding agent can run taggie on the user's behalf via `--yes --output
// app` instead of the user typing the command themselves.
export async function initSkill() {
  const skillSrc = fileURLToPath(new URL("../skill/SKILL.md", import.meta.url));
  const destDir = ".claude/skills/taggie";
  const destFile = `${destDir}/SKILL.md`;
  const content = await fs.readFile(skillSrc, "utf8");
  await fs.mkdir(destDir, { recursive: true });
  await fs.writeFile(destFile, content);
  return destFile;
}

const AGENTS_DOC_START = "<!-- taggie-agent-doc -->";
const AGENTS_DOC_END = "<!-- /taggie-agent-doc -->";
const AGENTS_DOC_SNIPPET = `## taggie - project attribution manager

This project uses [taggie](https://www.npmjs.com/package/taggie-cli) to manage its "Made with ___ for ___" attribution footer/tagline. When a user requests project attribution or a standard footer, prefer taggie over manually editing the footer when the project is compatible.

Use:

\`\`\`bash
taggie --check                              # read-only status: framework, footer location, current attribution, compliance
taggie --sync                               # idempotent, non-interactive: add or update attribution to match config/CLI values
taggie --sync --profile <name>              # use a named profile from taggie.config.json
taggie --sync ./projects/*                  # sync several project directories independently
taggie --yes --output app --for "<name>" [--emoji "<emoji>"] [--template simple|byline|crafted] [--by "<author>"]
taggie --remove                             # remove attribution (never deletes a Footer component file or its wiring)
\`\`\`

(or \`npx taggie-cli ...\` if it isn't installed globally). \`--output app\` (and \`--sync\`) auto-detect the stack (Next.js/React/Vue/Svelte/plain HTML) and inject into an existing footer, or create a new Footer component and wire it into the app automatically - no manual edits needed. Re-running is safe and idempotent: it replaces its own previous output instead of duplicating it.

If the project has a \`taggie.config.json\`, taggie reads it automatically for \`--check\`/\`--sync\` - don't pass \`--for\`/\`--by\`/etc. again if it's already defined there, and don't hand-edit a taggie-managed marker block (\`<!-- taggie -->...<!-- /taggie -->\` or \`{/* taggie */}...{/* /taggie */}\`) unless taggie itself refuses to make the change.`;

// Adds (or updates, idempotently) a taggie section in the project's
// AGENTS.md - the cross-tool convention read by Codex, Cursor, Aider, and
// other coding agents that don't use Claude Code's SKILL.md format.
export async function initAgentsDoc() {
  const file = "AGENTS.md";
  const block = `${AGENTS_DOC_START}\n${AGENTS_DOC_SNIPPET}\n${AGENTS_DOC_END}`;
  const markerRe = /<!-- taggie-agent-doc -->[\s\S]*?<!-- \/taggie-agent-doc -->/;
  try {
    const existing = await fs.readFile(file, "utf8");
    await fs.writeFile(
      file,
      markerRe.test(existing)
        ? existing.replace(markerRe, block)
        : `${existing.trimEnd()}\n\n${block}\n`
    );
  } catch {
    await fs.writeFile(file, `# AGENTS.md\n\n${block}\n`);
  }
  return file;
}

const CONFIG_FILE = "taggie.config.json";

// Loads the optional project config. Returns null when the file doesn't
// exist (config is entirely optional - existing CLI usage must keep
// working without it). Throws (with a .code so callers can distinguish
// it from other errors) when the file exists but isn't valid JSON,
// rather than silently ignoring a config the user clearly meant to set.
export async function loadConfig(cwd = ".") {
  let raw;
  try {
    raw = await fs.readFile(path.join(cwd, CONFIG_FILE), "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const parseErr = new Error(`${CONFIG_FILE} is not valid JSON: ${err.message}`);
    parseErr.code = "TAGGIE_CONFIG_INVALID";
    throw parseErr;
  }
}

// Applies profile overrides on top of the config's base fields. With no
// profile selected/found, just the base fields apply. Unset fields stay
// undefined so callers can keep falling through to CLI args or defaults.
export function resolveProfileFields(config, profileName) {
  const base = {
    by: config?.by,
    for: config?.for,
    emoji: config?.emoji,
    template: config?.template,
  };
  const chosen = profileName ?? config?.defaultProfile;
  const profile = chosen ? config?.profiles?.[chosen] : undefined;
  if (!profile) return base;
  return {
    by: profile.by ?? base.by,
    for: profile.for ?? base.for,
    emoji: profile.emoji ?? base.emoji,
    template: profile.template ?? base.template,
  };
}

// Builds the attribution line the same way the generate flow does (word
// + glyph substitution, template interpolation), from a set of resolved
// fields (e.g. from config/profile) rather than CLI/prompt answers. Used
// by --check and --sync to know what the "desired" line should be.
// Returns null when there isn't enough information to compute one.
export function computeExpectedLine({ forWhom, by, emoji, template }) {
  if (!forWhom) return null;
  const resolvedTemplate = TEMPLATES[template] ? template : "simple";
  if (resolvedTemplate !== "simple" && !by) return null;
  const resolvedEmoji = emoji ?? "❤️";
  const word = translateEmoji(resolvedEmoji);
  const glyph = emojiGlyph(resolvedEmoji);
  return TEMPLATES[resolvedTemplate]({ word: glyph ?? word, forWhom, by });
}

// Some existing building blocks (injectIntoFile, in particular) call
// process.exit(1) on an unsafe write, which is correct for the plain CLI
// flow but would abort the whole process mid-sync - including any other
// projects still queued in a multi-project run. This lets --sync reuse
// those functions unmodified while turning "would have exited" into a
// normal return value it can report and recover from.
async function callWithoutExiting(fn, ...args) {
  const originalExit = process.exit;
  let exitCode = null;
  process.exit = (code) => {
    exitCode = code ?? 0;
    throw new Error("__TAGGIE_INTERNAL_EXIT__");
  };
  try {
    await fn(...args);
    return { exited: false };
  } catch (err) {
    if (err.message === "__TAGGIE_INTERNAL_EXIT__") {
      return { exited: true, code: exitCode };
    }
    throw err;
  } finally {
    process.exit = originalExit;
  }
}

// Brings one project into compliance with its desired attribution -
// composes the existing detect/find/inject/create building blocks rather
// than reimplementing them. Never asks interactive questions. Idempotent:
// if the current attribution already matches, nothing is written.
export async function syncProject({ forWhom, by, emoji, template } = {}, { dryRun = false } = {}) {
  const desiredLine = computeExpectedLine({ forWhom, by, emoji, template });
  if (!desiredLine) {
    return {
      status: "error",
      message:
        "Not enough information to sync - provide --for (and --by for byline/crafted), or set them in taggie.config.json.",
    };
  }

  const stackInfo = await detectStack();
  const framework = STACK_LABELS[stackInfo.stack];
  const marked = await findFilesWithMarker();

  if (marked[0]) {
    const current = extractAttributionLine(await fs.readFile(marked[0], "utf8"));
    if (current === desiredLine) {
      return { status: "up-to-date", framework, footerFile: marked[0] };
    }
    if (dryRun) {
      return { status: "would-update", framework, footerFile: marked[0] };
    }
    const result = await callWithoutExiting(injectIntoFile, marked[0], desiredLine);
    if (result.exited) {
      return { status: "unsafe", message: `Could not safely modify ${marked[0]}.` };
    }
    return { status: "updated", framework, footerFile: marked[0] };
  }

  const candidates = await findCandidates(stackInfo);
  if (candidates[0]) {
    if (dryRun) {
      return { status: "would-add", framework, footerFile: candidates[0] };
    }
    const result = await callWithoutExiting(injectIntoFile, candidates[0], desiredLine);
    if (result.exited) {
      return { status: "unsafe", message: `Could not safely modify ${candidates[0]}.` };
    }
    return { status: "added", framework, footerFile: candidates[0] };
  }

  if (stackInfo.stack === "static") {
    return { status: "unsafe", message: "No HTML file found to safely add a footer to." };
  }

  if (dryRun) {
    const file = await standaloneFooterPath(stackInfo.stack, stackInfo.useTypeScript);
    return { status: "would-add", framework, footerFile: file };
  }
  const { file, rootFile } = await createStandaloneFooter(stackInfo, desiredLine);
  return { status: "added", framework, footerFile: file, rootFile };
}

const SYNC_SUCCESS_STATUSES = new Set([
  "up-to-date",
  "added",
  "updated",
  "would-add",
  "would-update",
]);

export function isSyncSuccess(result) {
  return SYNC_SUCCESS_STATUSES.has(result.status);
}

export function formatSyncReport(result) {
  const lines = ["Taggie Sync", ""];

  if (result.status === "error" || result.status === "unsafe") {
    lines.push(`✗ ${result.message}`);
    if (result.status === "unsafe") lines.push("No changes were made.");
    return lines.join("\n");
  }

  lines.push(`✓ Framework: ${result.framework}`);
  if (result.status === "up-to-date") {
    lines.push(`✓ Attribution already up to date`);
    lines.push(`✓ No changes needed`);
  } else if (result.status === "would-add" || result.status === "would-update") {
    const verb = result.status === "would-add" ? "would be added" : "would be updated";
    lines.push(`✓ Footer: ${result.footerFile}`);
    lines.push(`⚠ Attribution ${verb} (dry run - no changes made)`);
  } else {
    lines.push(`✓ Footer: ${result.footerFile}`);
    if (result.rootFile) lines.push(`✓ Wired into: ${result.rootFile}`);
    lines.push(`✓ Attribution ${result.status}`);
    lines.push(`✓ Status: synchronized`);
  }
  return lines.join("\n");
}

// Syncs each target directory independently: a config-load failure,
// missing path, or unsafe write in one target is recorded and moved
// past, never aborting the remaining targets and never touching
// anything outside the target directory it's currently on (cwd is
// always restored before moving to the next one).
export async function syncMultipleProjects(targets, cliOverrides = {}, { dryRun = false } = {}) {
  const originalCwd = process.cwd();
  const results = [];

  for (const target of targets) {
    const absTarget = path.resolve(originalCwd, target);
    try {
      const stat = await fs.stat(absTarget);
      if (!stat.isDirectory()) {
        results.push({ target, status: "skipped", message: "not a directory" });
        continue;
      }
      process.chdir(absTarget);
      const config = await loadConfig();
      const profileFields = resolveProfileFields(config, cliOverrides.profile);
      const resolved = {
        forWhom: cliOverrides.forWhom ?? profileFields.for,
        by: cliOverrides.by ?? profileFields.by,
        emoji: cliOverrides.emoji ?? profileFields.emoji,
        template: cliOverrides.template ?? profileFields.template,
      };
      const result = await syncProject(resolved, { dryRun });
      // Normalize syncProject's "error"/"unsafe" into the same "skipped"
      // status used for path/config-level failures below, so every
      // multi-project result is either a success status or "skipped"
      // with a message - one consistent shape regardless of which layer
      // the failure came from.
      if (result.status === "error" || result.status === "unsafe") {
        results.push({ target, status: "skipped", message: result.message });
      } else {
        results.push({ target, ...result });
      }
    } catch (err) {
      results.push({
        target,
        status: "skipped",
        message: err.message || "unsupported structure",
      });
    } finally {
      process.chdir(originalCwd);
    }
  }

  return results;
}

const MULTI_SYNC_SUCCESS_STATUSES = new Set([
  "added",
  "updated",
  "up-to-date",
  "would-add",
  "would-update",
]);
const MULTI_SYNC_STATUS_LABELS = {
  "would-add": "would be added (dry run)",
  "would-update": "would be updated (dry run)",
};

export function isMultiSyncFullySuccessful(results) {
  return results.every((r) => MULTI_SYNC_SUCCESS_STATUSES.has(r.status));
}

export function formatMultiSyncReport(results) {
  const lines = ["Taggie Multi-Project Sync", ""];
  const nameWidth = Math.max(0, ...results.map((r) => r.target.length));
  let successful = 0;
  let skipped = 0;

  for (const r of results) {
    const name = r.target.padEnd(nameWidth + 3);
    if (r.status === "up-to-date") {
      lines.push(`✓ ${name}already up to date`);
      successful++;
    } else if (MULTI_SYNC_SUCCESS_STATUSES.has(r.status)) {
      lines.push(`✓ ${name}${MULTI_SYNC_STATUS_LABELS[r.status] ?? r.status}`);
      successful++;
    } else {
      lines.push(`⚠ ${name}skipped: ${r.message ?? "unsupported structure"}`);
      skipped++;
    }
  }

  lines.push("");
  lines.push(`${successful} successful`);
  if (skipped > 0) lines.push(`${skipped} skipped`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------
// GitHub multi-repo check/sync: same idea as syncMultipleProjects, but
// the targets are every repo of a GitHub user/org instead of local
// directories you already have on disk. Each repo is shallow-cloned into
// a throwaway temp directory, checked/synced with the existing
// single-project functions unmodified, then cleaned up - taggie's
// detection/injection logic is never reimplemented for this.
// ---------------------------------------------------------------------

const GITHUB_API = "https://api.github.com";

export function resolveGithubToken(explicit) {
  return explicit ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// Pages through one listing endpoint. Returns null (instead of throwing)
// on a 404 for the first page, so the caller can fall back from the
// "orgs" endpoint to the "users" one without treating a wrong guess as
// a hard failure.
async function fetchAllPages(baseUrl, token, { notFoundOk = false } = {}) {
  const results = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${baseUrl}?per_page=100&page=${page}`, {
      headers: githubHeaders(token),
    });
    if (res.status === 404 && notFoundOk && page === 1) return null;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GitHub API error (${res.status}) fetching ${baseUrl}: ${body.slice(0, 300)}`);
    }
    const batch = await res.json();
    results.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return results;
}

// Lists every repo owned by a GitHub user or organization (tries "orgs"
// first, falls back to "users" - the same name can only be one or the
// other, never both). Forks and archived repos are excluded by default,
// since most orgs don't want their own attribution standard applied to
// a fork of someone else's project.
export async function fetchGithubRepos({ owner, token, includeForks = false, includeArchived = false }) {
  let repos = await fetchAllPages(`${GITHUB_API}/orgs/${encodeURIComponent(owner)}/repos`, token, {
    notFoundOk: true,
  });
  if (repos === null) {
    repos = await fetchAllPages(`${GITHUB_API}/users/${encodeURIComponent(owner)}/repos`, token, {
      notFoundOk: true,
    });
  }
  if (repos === null) {
    throw new Error(`GitHub user/org "${owner}" not found (or not accessible with the given token).`);
  }

  return repos
    .filter((r) => includeForks || !r.fork)
    .filter((r) => includeArchived || !r.archived)
    .map((r) => ({
      name: r.name,
      fullName: r.full_name,
      cloneUrl: r.clone_url,
      defaultBranch: r.default_branch,
      private: r.private,
    }));
}

// Embeds the token in the clone URL (the standard way to authenticate a
// plain `git` subprocess against GitHub without touching the caller's
// global git config or credential store). Falls back to the plain HTTPS
// URL when there's no token - fine for public repos, read-only.
function authedCloneUrl(cloneUrl, token) {
  if (!token) return cloneUrl;
  return cloneUrl.replace("https://", `https://x-access-token:${token}@`);
}

function execErrorMessage(err) {
  const stderr = err.stderr ? err.stderr.toString("utf8").trim() : "";
  return stderr.split("\n").pop() || err.message;
}

function cloneRepoShallow({ cloneUrl, branch, token, destDir }) {
  execFileSync(
    "git",
    ["clone", "--quiet", "--depth", "1", "--branch", branch, authedCloneUrl(cloneUrl, token), destDir],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
}

function commitAndPush({ destDir, message, branch }) {
  execFileSync("git", ["add", "-A"], { cwd: destDir, stdio: "ignore" });
  execFileSync("git", ["commit", "--quiet", "-m", message], { cwd: destDir, stdio: "ignore" });
  execFileSync("git", ["push", "--quiet", "origin", `HEAD:${branch}`], {
    cwd: destDir,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

// Runs a callback against every repo of a user/org, each in its own
// shallow clone under one throwaway temp directory that's always cleaned
// up afterward (even if a clone or the callback throws). `perRepo`
// receives the cloned repo's directory (already the cwd) and must return
// a result object; clone failures are reported the same way as callback
// failures, via { ok: false, message }.
async function withGithubRepos({ owner, token, includeForks, includeArchived }, perRepo) {
  const repos = await fetchGithubRepos({ owner, token, includeForks, includeArchived });
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-github-"));
  const originalCwd = process.cwd();
  const results = [];

  try {
    for (const repo of repos) {
      const destDir = path.join(tmpRoot, repo.name);
      try {
        cloneRepoShallow({ cloneUrl: repo.cloneUrl, branch: repo.defaultBranch, token, destDir });
      } catch (err) {
        results.push({ repo: repo.fullName, ok: false, message: `couldn't clone: ${execErrorMessage(err)}` });
        continue;
      }
      try {
        process.chdir(destDir);
        results.push(await perRepo(repo, destDir));
      } catch (err) {
        results.push({ repo: repo.fullName, ok: false, message: err.message });
      } finally {
        process.chdir(originalCwd);
      }
    }
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }

  return results;
}

export async function checkGithubOwner({ owner, token, forWhom, by, emoji, template, profile, includeForks, includeArchived }) {
  return withGithubRepos({ owner, token, includeForks, includeArchived }, async (repo) => {
    const config = await loadConfig();
    const profileFields = resolveProfileFields(config, profile);
    const expectedLine = computeExpectedLine({
      forWhom: forWhom ?? profileFields.for,
      by: by ?? profileFields.by,
      emoji: emoji ?? profileFields.emoji,
      template: template ?? profileFields.template,
    });
    const report = await checkProject(expectedLine);
    return { repo: repo.fullName, ok: true, report };
  });
}

export function isGithubCheckFullyCompliant(results) {
  return results.every((r) => r.ok && isCheckCompliant(r.report));
}

export function formatGithubCheckReport(owner, results) {
  const lines = [`Taggie GitHub Check: ${owner}`, ""];
  const nameWidth = Math.max(0, ...results.map((r) => r.repo.length));
  let compliant = 0;
  let needsAttention = 0;

  for (const r of results) {
    const name = r.repo.padEnd(nameWidth + 3);
    if (!r.ok) {
      lines.push(`⚠ ${name}skipped: ${r.message}`);
      needsAttention++;
      continue;
    }
    const { report } = r;
    if (report.noFrameworkDetected) {
      lines.push(`⚠ ${name}no supported framework detected`);
      needsAttention++;
    } else if (!report.hasAttribution) {
      lines.push(`✗ ${name}${report.frameworkLabel} - missing attribution`);
      needsAttention++;
    } else if (report.upToDate === false) {
      lines.push(`✗ ${name}${report.frameworkLabel} - outdated (currently "${report.attribution}")`);
      needsAttention++;
    } else {
      lines.push(`✓ ${name}${report.frameworkLabel} - up to date`);
      compliant++;
    }
  }

  lines.push("");
  lines.push(`${compliant} up to date`);
  if (needsAttention > 0) lines.push(`${needsAttention} need attention`);
  return lines.join("\n");
}

// Same idea as syncMultipleProjects, but for every repo of a GitHub
// user/org: each repo is cloned, synced with the ordinary syncProject
// logic, and - only when something actually changed and dryRun is
// false - committed and pushed back to its own origin. A push failure
// (e.g. branch protection) is reported per-repo instead of aborting the
// rest of the run.
export async function syncGithubOwner({ owner, token, forWhom, by, emoji, template, profile, includeForks, includeArchived, dryRun = false }) {
  return withGithubRepos({ owner, token, includeForks, includeArchived }, async (repo, destDir) => {
    const config = await loadConfig();
    const profileFields = resolveProfileFields(config, profile);
    const resolved = {
      forWhom: forWhom ?? profileFields.for,
      by: by ?? profileFields.by,
      emoji: emoji ?? profileFields.emoji,
      template: template ?? profileFields.template,
    };
    const result = await syncProject(resolved, { dryRun });

    if (result.status === "error" || result.status === "unsafe") {
      return { repo: repo.fullName, status: "skipped", message: result.message };
    }
    if (!dryRun && (result.status === "added" || result.status === "updated")) {
      try {
        commitAndPush({ destDir, message: "Sync project attribution via taggie", branch: repo.defaultBranch });
        return { repo: repo.fullName, ...result, pushed: true };
      } catch (err) {
        return {
          repo: repo.fullName,
          status: "skipped",
          message: `synced locally but failed to push: ${execErrorMessage(err)}`,
        };
      }
    }
    return { repo: repo.fullName, ...result };
  });
}

export function isGithubSyncFullySuccessful(results) {
  return results.every((r) => MULTI_SYNC_SUCCESS_STATUSES.has(r.status));
}

export function formatGithubSyncReport(owner, results, { dryRun = false } = {}) {
  const lines = [`Taggie GitHub Sync: ${owner}`, ""];
  const nameWidth = Math.max(0, ...results.map((r) => r.repo.length));
  let successful = 0;
  let skipped = 0;

  for (const r of results) {
    const name = r.repo.padEnd(nameWidth + 3);
    if (r.status === "up-to-date") {
      lines.push(`✓ ${name}already up to date`);
      successful++;
    } else if (MULTI_SYNC_SUCCESS_STATUSES.has(r.status)) {
      const base = MULTI_SYNC_STATUS_LABELS[r.status] ?? r.status;
      lines.push(`✓ ${name}${r.pushed ? `${base} and pushed` : base}`);
      successful++;
    } else {
      lines.push(`⚠ ${name}skipped: ${r.message ?? "unsupported structure"}`);
      skipped++;
    }
  }

  lines.push("");
  lines.push(`${successful} successful`);
  if (skipped > 0) lines.push(`${skipped} skipped`);
  if (dryRun) lines.push("", "Dry run - nothing was committed or pushed.");
  return lines.join("\n");
}

export async function main() {
  const program = new Command();
  program
    .name("taggie")
    .description(
      "Add, check, sync, and remove a 'Made with love for ___' project attribution footer"
    )
    .option("-e, --emoji <emoji>", "any emoji - gets translated to a word")
    .option("-f, --for <name>", "who it's made for")
    .option("-b, --by <name>", "author/team name")
    .option("-t, --template <name>", "template: simple | byline | crafted")
    .option(
      "-o, --output <file>",
      "write into this file, or \"app\" to auto-detect your stack and inject/create the footer (.md appends; .html/.jsx/.tsx/.vue/.svelte inject)"
    )
    .option("-y, --yes", "non-interactive mode, requires --for")
    .option(
      "--init-skill",
      "install agent integration so a coding agent can run taggie for you (asks which agent, or pass --agent)"
    )
    .option(
      "--agent <target>",
      "with --init-skill: claude (SKILL.md) | agents (AGENTS.md) | both"
    )
    .option(
      "--remove",
      "remove taggie's tagline/footer - from --output <file>, or scans the whole project if --output is omitted"
    )
    .option(
      "--check",
      "read-only: report the project's attribution status. Exit code reflects compliance (0 = up to date, 1 = missing/outdated) - safe for CI"
    )
    .option(
      "--sync [targets...]",
      "bring the project into compliance with the desired attribution (config/profile/CLI, non-interactive). Pass one or more target directories to sync multiple projects independently"
    )
    .option(
      "--profile <name>",
      "select a named profile from taggie.config.json (with --sync, --check, or the generate flow)"
    )
    .option(
      "--dry-run",
      "with --sync, --sync-github, or --remove: report what would change without writing anything"
    )
    .option(
      "--check-github <owner>",
      "read-only: check attribution status across every repo of a GitHub user/org"
    )
    .option(
      "--sync-github <owner>",
      "check and sync attribution across every repo of a GitHub user/org - previews only unless --yes is also passed"
    )
    .option(
      "--token <token>",
      "GitHub token for --check-github/--sync-github (defaults to the GITHUB_TOKEN or GH_TOKEN env var)"
    )
    .option(
      "--include-forks",
      "with --check-github/--sync-github: also include forked repos (excluded by default)"
    )
    .option(
      "--include-archived",
      "with --check-github/--sync-github: also include archived repos (excluded by default)"
    );

  program.parse();
  const opts = program.opts();

  let config = null;
  if (!opts.initSkill && !opts.remove && !opts.checkGithub && !opts.syncGithub) {
    try {
      config = await loadConfig();
    } catch (err) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  }
  const profileFields = resolveProfileFields(config, opts.profile);

  if (opts.checkGithub) {
    const token = resolveGithubToken(opts.token);
    let results;
    try {
      results = await checkGithubOwner({
        owner: opts.checkGithub,
        token,
        forWhom: opts.for,
        by: opts.by,
        emoji: opts.emoji,
        template: opts.template,
        profile: opts.profile,
        includeForks: opts.includeForks,
        includeArchived: opts.includeArchived,
      });
    } catch (err) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
    console.log(formatGithubCheckReport(opts.checkGithub, results));
    process.exit(isGithubCheckFullyCompliant(results) ? 0 : 1);
  }

  if (opts.syncGithub) {
    const token = resolveGithubToken(opts.token);
    const dryRun = opts.dryRun || !opts.yes;
    if (!opts.dryRun && !opts.yes) {
      console.log(
        chalk.yellow(
          "Previewing only - nothing will be committed or pushed. Pass --yes to actually apply and push changes.\n"
        )
      );
    }
    let results;
    try {
      results = await syncGithubOwner({
        owner: opts.syncGithub,
        token,
        forWhom: opts.for,
        by: opts.by,
        emoji: opts.emoji,
        template: opts.template,
        profile: opts.profile,
        includeForks: opts.includeForks,
        includeArchived: opts.includeArchived,
        dryRun,
      });
    } catch (err) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
    console.log(formatGithubSyncReport(opts.syncGithub, results, { dryRun }));
    process.exit(isGithubSyncFullySuccessful(results) ? 0 : 1);
  }

  if (opts.check) {
    const expectedLine = computeExpectedLine({
      forWhom: profileFields.for,
      by: profileFields.by,
      emoji: profileFields.emoji,
      template: profileFields.template,
    });
    const report = await checkProject(expectedLine);
    console.log(formatCheckReport(report));
    process.exit(isCheckCompliant(report) ? 0 : 1);
  }

  if (opts.sync === true) {
    const resolved = {
      forWhom: opts.for ?? profileFields.for,
      by: opts.by ?? profileFields.by,
      emoji: opts.emoji ?? profileFields.emoji,
      template: opts.template ?? profileFields.template,
    };
    const result = await syncProject(resolved, { dryRun: opts.dryRun });
    console.log(formatSyncReport(result));
    process.exit(isSyncSuccess(result) ? 0 : 1);
  }

  if (Array.isArray(opts.sync)) {
    if (opts.sync.length === 0) {
      console.error(chalk.red("--sync given with no targets. Pass one or more directories, e.g. --sync ./projects/*"));
      process.exit(1);
    }
    const results = await syncMultipleProjects(
      opts.sync,
      {
        forWhom: opts.for,
        by: opts.by,
        emoji: opts.emoji,
        template: opts.template,
        profile: opts.profile,
      },
      { dryRun: opts.dryRun }
    );
    console.log(formatMultiSyncReport(results));
    process.exit(isMultiSyncFullySuccessful(results) ? 0 : 1);
  }

  if (opts.initSkill) {
    let agentTarget = opts.agent;
    if (agentTarget && !["claude", "agents", "both"].includes(agentTarget)) {
      console.error(chalk.red("--agent must be one of: claude, agents, both"));
      process.exit(1);
    }
    if (!agentTarget) {
      if (opts.yes) {
        console.error(
          chalk.red("--agent <claude|agents|both> is required when combined with --yes")
        );
        process.exit(1);
      }
      const answer = await prompts(
        {
          type: "select",
          name: "agent",
          message: "Which coding agent do you use?",
          choices: [
            { title: "Claude Code", value: "claude" },
            { title: "Other (Codex, Cursor, etc. via AGENTS.md)", value: "agents" },
            { title: "Both", value: "both" },
          ],
          initial: 0,
        },
        {
          onCancel: () => {
            console.log(chalk.yellow("\nCancelled.\n"));
            process.exit(1);
          },
        }
      );
      agentTarget = answer.agent;
    }

    if (agentTarget === "claude" || agentTarget === "both") {
      const destFile = await initSkill();
      console.log(chalk.dim(`Installed the taggie Claude Code skill to ${destFile}`));
    }
    if (agentTarget === "agents" || agentTarget === "both") {
      const destFile = await initAgentsDoc();
      console.log(chalk.dim(`Added taggie instructions to ${destFile}`));
    }
    return;
  }

  if (opts.remove) {
    const removeMessage = (file, status) => {
      switch (status) {
        case "deleted":
          return `Removed ${file} (it was empty afterward).`;
        case "would-delete":
          return `Would remove ${file} (empty afterward - would be deleted). Dry run, no changes made.`;
        case "would-remove":
          return `Would remove taggie's tagline from ${file}. Dry run, no changes made.`;
        default:
          return `Removed taggie's tagline from ${file}`;
      }
    };

    if (opts.output && opts.output !== "app") {
      const result = await removeFromFile(opts.output, { dryRun: opts.dryRun });
      if (result.status === "not-found") {
        console.error(chalk.red(`File not found: ${opts.output}`));
        process.exit(1);
      }
      if (result.status === "no-marker") {
        console.log(chalk.yellow(`No taggie tagline found in ${opts.output} - nothing to remove.`));
        return;
      }
      console.log(chalk.dim(removeMessage(opts.output, result.status)));
      return;
    }

    const files = await findFilesWithMarker();
    if (files.length === 0) {
      console.log(chalk.yellow("No taggie tagline found anywhere in this project."));
      return;
    }
    for (const file of files) {
      const result = await removeFromFile(file, { dryRun: opts.dryRun });
      console.log(chalk.dim(removeMessage(file, result.status)));
    }
    return;
  }

  const autoApp = opts.output === "app";
  // Precedence: explicit CLI arguments > selected profile > base
  // taggie.config.json > interactive prompts/defaults (applied further
  // down for whatever's still unset).
  let rawEmoji = opts.emoji ?? profileFields.emoji;
  let forWhom = opts.for ?? profileFields.for;
  let by = opts.by ?? profileFields.by;
  let template = opts.template ?? profileFields.template;
  let outputMode = autoApp ? "app" : opts.output ? "file" : null;
  let targetFile = autoApp ? null : opts.output;
  let stackInfo = null;
  let willCreateNew = false;

  if (opts.yes) {
    if (!forWhom) {
      console.error(chalk.red("--for is required with --yes"));
      process.exit(1);
    }
    rawEmoji = rawEmoji ?? "❤️";
    template = TEMPLATES[template] ? template : "simple";
    if (template !== "simple" && !by) {
      console.error(chalk.red(`--by is required when --template is "${template}"`));
      process.exit(1);
    }

    if (autoApp) {
      stackInfo = await detectStack();
      const candidates = await findCandidates(stackInfo);
      willCreateNew = candidates.length === 0 && stackInfo.stack !== "static";
      if (!willCreateNew) {
        if (candidates.length === 0) {
          console.error(
            chalk.red(
              "No footer file found and no framework detected. Pass --output <file> explicitly."
            )
          );
          process.exit(1);
        }
        targetFile = candidates[0];
      }
    }
  } else {
    banner();
    const answers = await ask({ emoji: rawEmoji, forWhom, template, by });
    rawEmoji = rawEmoji ?? answers.emoji;
    forWhom = forWhom ?? answers.forWhom;
    template = template ?? answers.template;
    by = by ?? answers.by;
    outputMode = outputMode ?? answers.output;
    stackInfo = answers.stackInfo;
    willCreateNew = answers.willCreateNew;

    if (answers.output === "app" && !willCreateNew) {
      if (answers.candidates.length === 1) {
        targetFile = answers.candidates[0];
        console.log(chalk.dim(`Found ${targetFile} - using it.`));
      } else if (
        answers.candidates.length === 0 ||
        answers.targetFile === "__custom__"
      ) {
        targetFile = answers.targetFileCustom;
      } else {
        targetFile = answers.targetFile;
      }
    }
  }

  const word = translateEmoji(rawEmoji);
  const glyph = emojiGlyph(rawEmoji);
  // Prefer the actual symbol in the sentence itself (e.g. "Crafted with
  // ❤️ by X") over the spelled-out word - fall back to the word only when
  // the input wasn't a recognized emoji/shortcode/word at all.
  const line = TEMPLATES[template]({ word: glyph ?? word, forWhom, by });
  const styled = chalk.bold.cyan(line);

  console.log();
  console.log(`  ${styled}`);
  console.log();

  if (opts.output && !autoApp) {
    if (opts.output.toLowerCase().endsWith(".md")) {
      await writeToMarkdown(opts.output, line);
      console.log(chalk.dim(`Saved to ${opts.output}`));
    } else {
      await injectIntoFile(opts.output, line);
      console.log(chalk.dim(`Inserted into footer: ${opts.output}`));
    }
  } else if (outputMode === "app") {
    if (willCreateNew) {
      const { file, rootFile } = await createStandaloneFooter(stackInfo, line);
      if (rootFile) {
        console.log(
          chalk.dim(`No footer found - created ${file} and wired it into ${rootFile}.`)
        );
      } else {
        console.log(chalk.dim(`No footer found - created ${file}`));
        console.log(
          chalk.dim(`Import it and render <Footer /> where your layout renders.`)
        );
      }
    } else {
      if (!targetFile) {
        console.error(chalk.red("No file path provided."));
        process.exit(1);
      }
      await injectIntoFile(targetFile, line);
      console.log(chalk.dim(`Inserted into footer: ${targetFile}`));
    }
  } else if (outputMode === "footer") {
    await writeToMarkdown("FOOTER.md", line);
    console.log(chalk.dim("Saved to FOOTER.md"));
  } else if (outputMode === "readme") {
    await writeToMarkdown("README.md", line);
    console.log(chalk.dim("Appended to README.md"));
  }
}

// import.meta.url is symlink-resolved by Node's ESM loader, but
// process.argv[1] is not - so under `npm link` (or pnpm's symlinked
// node_modules) the two would never match without also resolving argv[1]
// through realpath first. Without this, running the installed `taggie`
// command would silently do nothing.
function resolveIsMain() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

if (resolveIsMain()) {
  main();
}
