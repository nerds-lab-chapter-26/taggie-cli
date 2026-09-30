import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  translateEmoji,
  emojiGlyph,
  TEMPLATES,
  detectStack,
  findNestedFrameworkHint,
  findCandidates,
  writeToMarkdown,
  injectIntoFile,
  footerExt,
  standaloneFooterPath,
  standaloneFooterContent,
  createStandaloneFooter,
  findRootFile,
  wireFooterIntoRoot,
  initSkill,
  initAgentsDoc,
  removeFromFile,
  findFilesWithMarker,
  extractAttributionLine,
  checkProject,
  isCheckCompliant,
  formatCheckReport,
  loadConfig,
  resolveProfileFields,
  computeExpectedLine,
  syncProject,
  isSyncSuccess,
  formatSyncReport,
  syncMultipleProjects,
  isMultiSyncFullySuccessful,
  formatMultiSyncReport,
  resolveGithubToken,
  fetchGithubRepos,
  isGithubCheckFullyCompliant,
  formatGithubCheckReport,
  isGithubSyncFullySuccessful,
  formatGithubSyncReport,
} from "../bin/taggie.js";

const RUN_INJECT = fileURLToPath(
  new URL("../scripts/run-inject-fixture.mjs", import.meta.url)
);
const CLI_PATH = fileURLToPath(new URL("../bin/taggie.js", import.meta.url));

// Runs the real CLI end-to-end (no prompts.inject mocking) with --yes,
// which is what a Claude Code Skill would drive since it has no TTY to
// answer interactive prompts.
function runCli(args, cwd) {
  return execFileSync(process.execPath, [CLI_PATH, "--yes", ...args], {
    encoding: "utf8",
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// injectIntoFile calls process.exit(1) on failure, which would kill the
// whole test run in-process - so failure cases are exercised in a
// subprocess instead, asserting on its exit code/stderr.
function runInjectSubprocess(file, line) {
  return execFileSync(process.execPath, [RUN_INJECT, file, line], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("translateEmoji", () => {
  test("translates a unicode emoji character", () => {
    assert.equal(translateEmoji("❤️"), "love");
  });

  test("translates a :shortcode:", () => {
    assert.equal(translateEmoji(":fire:"), "fire");
  });

  test("translates a plain word", () => {
    assert.equal(translateEmoji("rocket"), "rocket");
  });

  test("applies word overrides (sparkles -> magic)", () => {
    assert.equal(translateEmoji("sparkles"), "magic");
  });

  test("applies word overrides for heart variants", () => {
    assert.equal(translateEmoji("blue_heart"), "love");
    assert.equal(translateEmoji(":green_heart:"), "love");
  });

  test("falls back to the raw word when not a recognized emoji", () => {
    assert.equal(translateEmoji("teamwork"), "teamwork");
  });

  test("strips stray colons from an unrecognized shortcode-shaped word", () => {
    assert.equal(translateEmoji(":teamwork:"), "teamwork");
  });

  test("defaults to love on empty input", () => {
    assert.equal(translateEmoji(""), "love");
    assert.equal(translateEmoji("   "), "love");
  });

  test("replaces underscores in multi-word emoji keys without an override", () => {
    assert.equal(translateEmoji("thumbsup"), "thumbsup");
    assert.equal(translateEmoji("man_dancing"), "man dancing");
  });
});

describe("emojiGlyph", () => {
  // Regression coverage: the rendered tagline used to contain only the
  // translated word, never the actual symbol - regardless of how it was
  // typed (glyph, shortcode, or plain word), the same glyph must resolve.
  test("resolves the same glyph whether input is a unicode char, shortcode, or plain word", () => {
    assert.equal(emojiGlyph("🔥"), "🔥");
    assert.equal(emojiGlyph(":fire:"), "🔥");
    assert.equal(emojiGlyph("fire"), "🔥");
  });

  test("applies to override words too (sparkles -> magic keeps its ✨ glyph)", () => {
    assert.equal(emojiGlyph("sparkles"), "✨");
  });

  test("returns null for an unrecognized word", () => {
    assert.equal(emojiGlyph("teamwork"), null);
  });

  test("returns null for empty input", () => {
    assert.equal(emojiGlyph(""), null);
    assert.equal(emojiGlyph(undefined), null);
  });
});

describe("TEMPLATES", () => {
  test("simple ignores `by`", () => {
    assert.equal(
      TEMPLATES.simple({ word: "love", forWhom: "2Nerds" }),
      "Made with love for 2Nerds"
    );
  });

  test("byline includes both by and forWhom", () => {
    assert.equal(
      TEMPLATES.byline({ word: "love", forWhom: "2Nerds", by: "Maryam" }),
      "Made with love by Maryam for 2Nerds"
    );
  });

  test("crafted includes both by and forWhom", () => {
    // Regression: crafted used to silently drop forWhom even though the
    // CLI always asks "who is this for?" before the template question -
    // it must appear in the output like byline's does.
    assert.equal(
      TEMPLATES.crafted({ word: "fire", by: "Maryam", forWhom: "2Nerds" }),
      "Crafted with fire by Maryam for 2Nerds"
    );
  });
});

describe("footerExt", () => {
  test("vue stays .vue regardless of TypeScript", () => {
    assert.equal(footerExt("vue", true), "vue");
    assert.equal(footerExt("vue", false), "vue");
  });

  test("svelte stays .svelte regardless of TypeScript", () => {
    assert.equal(footerExt("svelte", true), "svelte");
  });

  test("react/next use tsx when TypeScript is detected, else jsx", () => {
    assert.equal(footerExt("react", true), "tsx");
    assert.equal(footerExt("react", false), "jsx");
    assert.equal(footerExt("next", true), "tsx");
    assert.equal(footerExt("next", false), "jsx");
  });
});

describe("standaloneFooterContent", () => {
  test("react/next content has JSX comment markers and the tagline", () => {
    const content = standaloneFooterContent("react", "Made with love for 2Nerds");
    assert.match(content, /\{\/\* taggie \*\/\}/);
    assert.match(content, /\{\/\* \/taggie \*\/\}/);
    assert.match(content, /<footer[\s>]/);
    assert.match(content, /Made with love for 2Nerds/);
  });

  test("vue content wraps a <template> with the tagline", () => {
    const content = standaloneFooterContent("vue", "Made with fire for X");
    assert.match(content, /<template>/);
    assert.match(content, /<footer[\s>]/);
    assert.match(content, /Made with fire for X/);
  });

  test("svelte content is a bare <footer> block", () => {
    const content = standaloneFooterContent("svelte", "Made with love for X");
    assert.match(content, /^<footer[\s>]/);
    assert.match(content, /Made with love for X/);
  });
});

// Filesystem-backed tests run inside a fresh temp directory per test so
// they never touch the real project files.
describe("filesystem-backed behavior", () => {
  let tmpDir;
  let originalCwd;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-test-"));
    process.chdir(tmpDir);
  });

  const cleanup = async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  };

  describe("detectStack", () => {
    test("defaults to static when there is no package.json", async () => {
      const info = await detectStack();
      assert.equal(info.stack, "static");
      await cleanup();
    });

    test("detects next.js from dependencies", async () => {
      await fs.writeFile(
        "package.json",
        JSON.stringify({ dependencies: { next: "^14.0.0", react: "^18.0.0" } })
      );
      const info = await detectStack();
      assert.equal(info.stack, "next");
      await cleanup();
    });

    test("detects vue from dependencies", async () => {
      await fs.writeFile(
        "package.json",
        JSON.stringify({ dependencies: { vue: "^3.0.0" } })
      );
      assert.equal((await detectStack()).stack, "vue");
      await cleanup();
    });

    test("detects svelte from devDependencies (@sveltejs/kit)", async () => {
      await fs.writeFile(
        "package.json",
        JSON.stringify({ devDependencies: { "@sveltejs/kit": "^2.0.0" } })
      );
      assert.equal((await detectStack()).stack, "svelte");
      await cleanup();
    });

    test("detects plain react when next/vue/svelte are absent", async () => {
      await fs.writeFile(
        "package.json",
        JSON.stringify({ dependencies: { react: "^18.0.0" } })
      );
      assert.equal((await detectStack()).stack, "react");
      await cleanup();
    });

    test("prioritizes next over react when both are present", async () => {
      await fs.writeFile(
        "package.json",
        JSON.stringify({ dependencies: { next: "^14.0.0", react: "^18.0.0" } })
      );
      assert.equal((await detectStack()).stack, "next");
      await cleanup();
    });

    test("detects TypeScript via tsconfig.json presence", async () => {
      await fs.writeFile(
        "package.json",
        JSON.stringify({ dependencies: { react: "^18.0.0" } })
      );
      await fs.writeFile("tsconfig.json", "{}");
      const info = await detectStack();
      assert.equal(info.useTypeScript, true);
      await cleanup();
    });
  });

  describe("findNestedFrameworkHint", () => {
    // Regression coverage for running taggie one folder above the real
    // app root (e.g. a wrapper directory whose only dependency is
    // taggie-cli itself, with the actual Next.js app nested inside it).
    test("finds a Next.js project in an immediate subdirectory", async () => {
      await fs.writeFile("package.json", JSON.stringify({ dependencies: { "taggie-cli": "^0.1.6" } }));
      await fs.mkdir("my-app", { recursive: true });
      await fs.writeFile(
        "my-app/package.json",
        JSON.stringify({ dependencies: { next: "^14.0.0", react: "^18.0.0" } })
      );
      const hint = await findNestedFrameworkHint();
      assert.deepEqual(hint, { dir: "my-app", stack: "next" });
      await cleanup();
    });

    test("returns null when no subdirectory has a recognizable framework", async () => {
      await fs.mkdir("scripts", { recursive: true });
      await fs.writeFile("scripts/package.json", JSON.stringify({ dependencies: {} }));
      const hint = await findNestedFrameworkHint();
      assert.equal(hint, null);
      await cleanup();
    });

    test("ignores node_modules and dotfolders", async () => {
      await fs.mkdir("node_modules/some-pkg", { recursive: true });
      await fs.writeFile(
        "node_modules/some-pkg/package.json",
        JSON.stringify({ dependencies: { next: "^14.0.0" } })
      );
      const hint = await findNestedFrameworkHint();
      assert.equal(hint, null);
      await cleanup();
    });
  });

  describe("findCandidates", () => {
    test("static stack returns every html file, shallowest first", async () => {
      await fs.mkdir("nested", { recursive: true });
      await fs.writeFile("nested/about.html", "<html></html>");
      await fs.writeFile("index.html", "<html></html>");
      const candidates = await findCandidates({ stack: "static", useTypeScript: false });
      assert.deepEqual(candidates, ["index.html", "nested/about.html"]);
      await cleanup();
    });

    test("static stack ignores node_modules", async () => {
      await fs.mkdir("node_modules/pkg", { recursive: true });
      await fs.writeFile("node_modules/pkg/index.html", "<html></html>");
      await fs.writeFile("index.html", "<html></html>");
      const candidates = await findCandidates({ stack: "static", useTypeScript: false });
      assert.deepEqual(candidates, ["index.html"]);
      await cleanup();
    });

    test("react stack prefers files that already contain a <footer> tag", async () => {
      await fs.mkdir("src", { recursive: true });
      await fs.writeFile(
        "src/App.jsx",
        "export default function App() { return <footer>hi</footer>; }"
      );
      await fs.writeFile("src/Other.jsx", "export default function Other() { return <div/>; }");
      const candidates = await findCandidates({ stack: "react", useTypeScript: false });
      assert.deepEqual(candidates, ["src/App.jsx"]);
      await cleanup();
    });

    test("react stack falls back to a Footer-named file when no <footer> tag exists", async () => {
      await fs.mkdir("src/components", { recursive: true });
      await fs.writeFile("src/components/Footer.jsx", "export default function Footer() { return <div/>; }");
      await fs.writeFile("src/App.jsx", "export default function App() { return <div/>; }");
      const candidates = await findCandidates({ stack: "react", useTypeScript: false });
      assert.deepEqual(candidates, ["src/components/Footer.jsx"]);
      await cleanup();
    });

    test("react stack returns empty when nothing qualifies", async () => {
      await fs.mkdir("src", { recursive: true });
      await fs.writeFile("src/App.jsx", "export default function App() { return <div/>; }");
      const candidates = await findCandidates({ stack: "react", useTypeScript: false });
      assert.deepEqual(candidates, []);
      await cleanup();
    });

    test("vue stack only scans .vue files", async () => {
      await fs.mkdir("src", { recursive: true });
      await fs.writeFile("src/App.vue", "<template><footer>hi</footer></template>");
      await fs.writeFile("src/App.jsx", "<footer>should be ignored</footer>");
      const candidates = await findCandidates({ stack: "vue", useTypeScript: false });
      assert.deepEqual(candidates, ["src/App.vue"]);
      await cleanup();
    });
  });

  describe("writeToMarkdown", () => {
    test("creates the file with markers when it doesn't exist", async () => {
      await writeToMarkdown("FOOTER.md", "Made with love for X");
      const content = await fs.readFile("FOOTER.md", "utf8");
      assert.match(content, /<!-- taggie -->/);
      assert.match(content, /Made with love for X/);
      await cleanup();
    });

    test("appends with markers when the file exists but has none", async () => {
      await fs.writeFile("README.md", "# My Project\n");
      await writeToMarkdown("README.md", "Made with love for X");
      const content = await fs.readFile("README.md", "utf8");
      assert.match(content, /# My Project/);
      assert.match(content, /Made with love for X/);
      await cleanup();
    });

    test("re-running replaces the previous block instead of duplicating it", async () => {
      await writeToMarkdown("FOOTER.md", "Made with love for X");
      await writeToMarkdown("FOOTER.md", "Made with fire for Y");
      const content = await fs.readFile("FOOTER.md", "utf8");
      assert.equal(content.match(/<!-- taggie -->/g).length, 1);
      assert.match(content, /Made with fire for Y/);
      assert.doesNotMatch(content, /Made with love for X/);
      await cleanup();
    });
  });

  describe("injectIntoFile", () => {
    test("inserts inside an existing <footer> tag", async () => {
      await fs.writeFile("index.html", "<html><body><footer></footer></body></html>");
      await injectIntoFile("index.html", "Made with love for X");
      const content = await fs.readFile("index.html", "utf8");
      assert.match(content, /<footer>\s*<!-- taggie -->/);
      assert.match(content, /Made with love for X/);
      await cleanup();
    });

    test("never overrides styling on a pre-existing <footer> tag", async () => {
      await fs.writeFile(
        "index.html",
        '<html><body><footer class="site-footer" style="background:navy"></footer></body></html>'
      );
      await injectIntoFile("index.html", "Made with love for X");
      const content = await fs.readFile("index.html", "utf8");
      assert.match(content, /<footer class="site-footer" style="background:navy">/);
      assert.doesNotMatch(content, /text-align:\s*center/);
      await cleanup();
    });

    test("creates a new <footer> before </body> when html has none", async () => {
      await fs.writeFile("index.html", "<html><body></body></html>");
      await injectIntoFile("index.html", "Made with love for X");
      const content = await fs.readFile("index.html", "utf8");
      assert.match(content, /<footer[^>]*>[\s\S]*Made with love for X[\s\S]*<\/footer>\s*<\/body>/);
      // a newly-created footer wrapper must be centered
      assert.match(content, /text-align:\s*center/);
      await cleanup();
    });

    test("wraps a new <footer> inside <template> for a bare .vue file", async () => {
      await fs.writeFile("App.vue", "<template><div>hi</div></template>");
      await injectIntoFile("App.vue", "Made with love for X");
      const content = await fs.readFile("App.vue", "utf8");
      assert.match(content, /<template>\s*<footer[^>]*>/);
      assert.match(content, /Made with love for X/);
      await cleanup();
    });

    test("inserts after the first returned element for a Footer-named jsx file with no <footer> tag", async () => {
      await fs.writeFile(
        "Footer.jsx",
        "export default function Footer() {\n  return (\n    <div className=\"footer\"></div>\n  );\n}\n"
      );
      await injectIntoFile("Footer.jsx", "Made with love for X");
      const content = await fs.readFile("Footer.jsx", "utf8");
      assert.match(content, /\{\/\* taggie \*\/\}/);
      assert.match(content, /Made with love for X/);
      await cleanup();
    });

    test("re-running replaces the previous marker block instead of duplicating it", async () => {
      await fs.writeFile("index.html", "<html><body><footer></footer></body></html>");
      await injectIntoFile("index.html", "Made with love for X");
      await injectIntoFile("index.html", "Made with fire for Y");
      const content = await fs.readFile("index.html", "utf8");
      assert.equal(content.match(/<!-- taggie -->/g).length, 1);
      assert.match(content, /Made with fire for Y/);
      assert.doesNotMatch(content, /Made with love for X/);
      await cleanup();
    });

    // Regression test for the bug where a plain (non-Footer-named) page
    // component with no existing <footer> tag - e.g. a fresh Next.js
    // app/page.tsx - got the tagline appended as dead text after the
    // component's closing brace, outside the JSX tree, so it silently
    // never rendered even though taggie reported success.
    test("inserts into the JSX return of a plain page component, not after it", async () => {
      await fs.writeFile(
        "page.tsx",
        "export default function Home() {\n  return (\n    <div className=\"flex\">\n      <main>hi</main>\n    </div>\n  );\n}\n"
      );
      await injectIntoFile("page.tsx", "Made with love for X");
      const content = await fs.readFile("page.tsx", "utf8");
      assert.match(content, /Made with love for X/);
      // the closing brace of the function must come AFTER the snippet -
      // i.e. the snippet landed inside the returned JSX, not appended past it
      const snippetIndex = content.indexOf("Made with love for X");
      const closingBraceIndex = content.lastIndexOf("}");
      assert.ok(
        snippetIndex < closingBraceIndex,
        "tagline should be inserted inside the component, before its closing brace"
      );
      await cleanup();
    });

    test("appends a new top-level <footer> for a bare .svelte file (no <footer>, no marker)", async () => {
      await fs.writeFile("App.svelte", "<script>\n  let name = 'world';\n</script>\n\n<h1>Hello {name}</h1>\n");
      await injectIntoFile("App.svelte", "Made with love for X");
      const content = await fs.readFile("App.svelte", "utf8");
      assert.match(content, /<footer[^>]*>[\s\S]*Made with love for X[\s\S]*<\/footer>/);
      await cleanup();
    });

    test("refuses to write and exits non-zero for a JSX file with no <footer> and no return statement", async () => {
      await fs.writeFile("utils.tsx", "export const helper = () => 42;\n");
      assert.throws(() => runInjectSubprocess("utils.tsx", "Made with love for X"));
      const content = await fs.readFile("utils.tsx", "utf8");
      assert.equal(content, "export const helper = () => 42;\n");
      await cleanup();
    });

    test("refuses to write and exits non-zero for a .vue file with no <template>", async () => {
      await fs.writeFile("Weird.vue", "<script setup>\nconst x = 1;\n</script>\n");
      assert.throws(() => runInjectSubprocess("Weird.vue", "Made with love for X"));
      const content = await fs.readFile("Weird.vue", "utf8");
      assert.equal(content, "<script setup>\nconst x = 1;\n</script>\n");
      await cleanup();
    });

    test("refuses to write for an unrecognized extension instead of blindly appending", async () => {
      await fs.writeFile("data.txt", "just some text\n");
      assert.throws(() => runInjectSubprocess("data.txt", "Made with love for X"));
      const content = await fs.readFile("data.txt", "utf8");
      assert.equal(content, "just some text\n");
      await cleanup();
    });
  });

  describe("createStandaloneFooter", () => {
    test("creates missing parent directories before writing", async () => {
      const { file, rootFile } = await createStandaloneFooter(
        { stack: "react", useTypeScript: false },
        "Made with love for X"
      );
      assert.equal(file, "components/Footer.jsx");
      assert.equal(rootFile, null); // no App.jsx present to wire into
      const content = await fs.readFile(file, "utf8");
      assert.match(content, /Made with love for X/);
      await cleanup();
    });

    test("nests under src/components when a src dir exists", async () => {
      await fs.mkdir("src", { recursive: true });
      const { file, rootFile } = await createStandaloneFooter(
        { stack: "react", useTypeScript: true },
        "Made with fire for Y"
      );
      assert.equal(file, "src/components/Footer.tsx");
      assert.equal(rootFile, null);
      const content = await fs.readFile(file, "utf8");
      assert.match(content, /Made with fire for Y/);
      await cleanup();
    });

    test("wires the new footer into the root file when one exists", async () => {
      await fs.mkdir("app", { recursive: true });
      await fs.writeFile(
        "app/layout.tsx",
        "export default function RootLayout({ children }) {\n  return (\n    <html>\n      <body>{children}</body>\n    </html>\n  );\n}\n"
      );
      const { file, rootFile } = await createStandaloneFooter(
        { stack: "next", useTypeScript: true },
        "Made with love for X"
      );
      assert.equal(rootFile, "app/layout.tsx");
      const layout = await fs.readFile("app/layout.tsx", "utf8");
      assert.match(layout, /import Footer from "\.\/components\/Footer"/);
      assert.match(layout, /\{children\}\s*\n\s*<Footer \/>/);
      const content = await fs.readFile(file, "utf8");
      assert.match(content, /Made with love for X/);
      await cleanup();
    });
  });

  describe("findRootFile", () => {
    test("finds app/layout.tsx for next", async () => {
      await fs.mkdir("app", { recursive: true });
      await fs.writeFile("app/layout.tsx", "export default function L() { return null; }");
      assert.equal(await findRootFile("next"), "app/layout.tsx");
      await cleanup();
    });

    test("falls back to pages/_app.jsx when there's no app/layout", async () => {
      await fs.mkdir("pages", { recursive: true });
      await fs.writeFile("pages/_app.jsx", "export default function App() { return null; }");
      assert.equal(await findRootFile("next"), "pages/_app.jsx");
      await cleanup();
    });

    test("finds src/App.vue for vue", async () => {
      await fs.mkdir("src", { recursive: true });
      await fs.writeFile("src/App.vue", "<template><div/></template>");
      assert.equal(await findRootFile("vue"), "src/App.vue");
      await cleanup();
    });

    test("returns null when no candidate exists", async () => {
      assert.equal(await findRootFile("react"), null);
      await cleanup();
    });
  });

  describe("wireFooterIntoRoot", () => {
    test("inserts <Footer /> right after {children} and adds the import", async () => {
      await fs.writeFile(
        "layout.tsx",
        'export default function RootLayout({ children }) {\n  return (\n    <body>{children}</body>\n  );\n}\n'
      );
      const ok = await wireFooterIntoRoot("layout.tsx", "components/Footer.tsx");
      assert.equal(ok, true);
      const content = await fs.readFile("layout.tsx", "utf8");
      assert.match(content, /import Footer from "\.\/components\/Footer";/);
      assert.match(content, /\{children\}\s*\n\s*<Footer \/>/);
      await cleanup();
    });

    test("falls back to inserting after the return's opening tag when there's no {children}", async () => {
      await fs.writeFile(
        "App.jsx",
        "export default function App() {\n  return (\n    <div className=\"app\">\n      <h1>hi</h1>\n    </div>\n  );\n}\n"
      );
      const ok = await wireFooterIntoRoot("App.jsx", "src/components/Footer.jsx");
      assert.equal(ok, true);
      const content = await fs.readFile("App.jsx", "utf8");
      assert.match(content, /import Footer from "\.\/src\/components\/Footer";/);
      assert.match(content, /<div className="app">\s*\n\s*<Footer \/>/);
      await cleanup();
    });

    test("is idempotent - re-running does not duplicate the import or the tag", async () => {
      await fs.writeFile(
        "layout.tsx",
        'export default function RootLayout({ children }) {\n  return (\n    <body>{children}</body>\n  );\n}\n'
      );
      await wireFooterIntoRoot("layout.tsx", "components/Footer.tsx");
      await wireFooterIntoRoot("layout.tsx", "components/Footer.tsx");
      const content = await fs.readFile("layout.tsx", "utf8");
      assert.equal((content.match(/<Footer \/>/g) ?? []).length, 1);
      assert.equal((content.match(/import Footer from/g) ?? []).length, 1);
      await cleanup();
    });

    test("wires into a Vue root file's <script setup> and <template>", async () => {
      await fs.writeFile("App.vue", "<script setup>\nimport {} from 'vue';\n</script>\n<template>\n  <div>hi</div>\n</template>\n");
      const ok = await wireFooterIntoRoot("App.vue", "src/components/Footer.vue");
      assert.equal(ok, true);
      const content = await fs.readFile("App.vue", "utf8");
      assert.match(content, /import Footer from "\.\/src\/components\/Footer";/);
      assert.match(content, /<Footer \/>\s*\n<\/template>/);
      await cleanup();
    });

    test("wires into a Svelte root file's <script> and appends the tag", async () => {
      await fs.writeFile("App.svelte", "<script>\n  let x = 1;\n</script>\n\n<h1>hi</h1>\n");
      const ok = await wireFooterIntoRoot("App.svelte", "src/lib/Footer.svelte");
      assert.equal(ok, true);
      const content = await fs.readFile("App.svelte", "utf8");
      assert.match(content, /import Footer from "\.\/src\/lib\/Footer";/);
      assert.match(content, /<Footer \/>\s*$/);
      await cleanup();
    });

    test("returns false without writing anything when the root file has no safe insertion point", async () => {
      await fs.writeFile("weird.jsx", "export const helper = () => 42;\n");
      const before = await fs.readFile("weird.jsx", "utf8");
      const ok = await wireFooterIntoRoot("weird.jsx", "components/Footer.jsx");
      assert.equal(ok, false);
      const after = await fs.readFile("weird.jsx", "utf8");
      assert.equal(before, after);
      await cleanup();
    });

    test("returns false when the root file doesn't exist", async () => {
      const ok = await wireFooterIntoRoot("missing.jsx", "components/Footer.jsx");
      assert.equal(ok, false);
      await cleanup();
    });
  });

  describe("standaloneFooterPath", () => {
    test("next.js uses app/components when an app dir exists", async () => {
      await fs.mkdir("app", { recursive: true });
      const p = await standaloneFooterPath("next", false);
      assert.equal(p, "app/components/Footer.jsx");
      await cleanup();
    });

    test("next.js falls back to components/ when there is no app dir", async () => {
      const p = await standaloneFooterPath("next", true);
      assert.equal(p, "components/Footer.tsx");
      await cleanup();
    });

    test("react uses src/components when a src dir exists", async () => {
      await fs.mkdir("src", { recursive: true });
      const p = await standaloneFooterPath("react", false);
      assert.equal(p, "src/components/Footer.jsx");
      await cleanup();
    });

    test("svelte uses src/lib when a src dir exists", async () => {
      await fs.mkdir("src", { recursive: true });
      const p = await standaloneFooterPath("svelte", false);
      assert.equal(p, "src/lib/Footer.svelte");
      await cleanup();
    });
  });
});

describe("CLI entry point", () => {
  // Regression test: `npm link` (and pnpm's node_modules layout) installs
  // the CLI as a symlink. Node's ESM loader resolves import.meta.url
  // through the symlink to the real file, but process.argv[1] keeps the
  // invoked (symlinked) path - so the "is this the entry module" check
  // must resolve argv[1] through realpath too, or `main()` silently never
  // runs and the installed `taggie` command does nothing.
  test("still runs when invoked through a symlink", async (t) => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-symlink-"));
    const linkPath = path.join(tmpDir, "taggie-entry.js");
    const realPath = fileURLToPath(new URL("../bin/taggie.js", import.meta.url));
    try {
      await fs.symlink(realPath, linkPath, "file");
    } catch (err) {
      t.skip(`symlinks not permitted in this environment: ${err.message}`);
      await fs.rm(tmpDir, { recursive: true, force: true });
      return;
    }
    const output = execFileSync(
      process.execPath,
      [linkPath, "--yes", "--for", "SymlinkTest"],
      { encoding: "utf8" }
    );
    assert.match(output, /Made with love for SymlinkTest/);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

describe("initSkill", () => {
  let tmpDir;
  let originalCwd;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-skill-"));
    process.chdir(tmpDir);
  });

  const cleanup = async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  };

  test("copies the bundled SKILL.md into .claude/skills/taggie/", async () => {
    const destFile = await initSkill();
    assert.equal(destFile, ".claude/skills/taggie/SKILL.md");
    const content = await fs.readFile(destFile, "utf8");
    assert.match(content, /^---\nname: taggie/);
    assert.match(content, /--output app/);
    // Phase 7: the skill should point agents at the full attribution
    // lifecycle, not just adding a tagline
    assert.match(content, /taggie --check/);
    assert.match(content, /taggie --sync/);
    assert.match(content, /taggie\.config\.json/);
    await cleanup();
  });

  test("--init-skill --agent claude works from the CLI end-to-end", async () => {
    const output = execFileSync(
      process.execPath,
      [CLI_PATH, "--init-skill", "--agent", "claude"],
      { encoding: "utf8" }
    );
    assert.match(output, /Installed the taggie Claude Code skill to \.claude[\\/]skills[\\/]taggie[\\/]SKILL\.md/);
    const content = await fs.readFile(".claude/skills/taggie/SKILL.md", "utf8");
    assert.match(content, /^---\nname: taggie/);
    await cleanup();
  });
});

describe("initAgentsDoc", () => {
  let tmpDir;
  let originalCwd;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-agents-"));
    process.chdir(tmpDir);
  });

  const cleanup = async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  };

  test("creates AGENTS.md with the taggie section when none exists", async () => {
    const file = await initAgentsDoc();
    assert.equal(file, "AGENTS.md");
    const content = await fs.readFile(file, "utf8");
    assert.match(content, /## taggie - project attribution manager/);
    assert.match(content, /--output app/);
    // Phase 7: agents should be pointed at check/sync/remove, not just add
    assert.match(content, /taggie --check/);
    assert.match(content, /taggie --sync/);
    assert.match(content, /taggie --remove/);
    assert.match(content, /taggie\.config\.json/);
    await cleanup();
  });

  test("appends the taggie section to an existing AGENTS.md, preserving prior content", async () => {
    await fs.writeFile("AGENTS.md", "# AGENTS.md\n\n## Build\n\nRun `npm run build`.\n");
    await initAgentsDoc();
    const content = await fs.readFile("AGENTS.md", "utf8");
    assert.match(content, /## Build/);
    assert.match(content, /## taggie - project attribution manager/);
    await cleanup();
  });

  test("re-running replaces the previous taggie section instead of duplicating it", async () => {
    await initAgentsDoc();
    await initAgentsDoc();
    const content = await fs.readFile("AGENTS.md", "utf8");
    assert.equal((content.match(/<!-- taggie-agent-doc -->/g) ?? []).length, 1);
    await cleanup();
  });
});

describe("CLI: --init-skill --agent", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-init-agent-"));
  });

  const cleanup = () => fs.rm(tmpDir, { recursive: true, force: true });

  test("--agent agents installs AGENTS.md only, not the Claude skill", async () => {
    const output = execFileSync(
      process.execPath,
      [CLI_PATH, "--init-skill", "--agent", "agents"],
      { encoding: "utf8", cwd: tmpDir }
    );
    assert.match(output, /Added taggie instructions to AGENTS\.md/);
    await assert.doesNotReject(fs.access(path.join(tmpDir, "AGENTS.md")));
    await assert.rejects(fs.access(path.join(tmpDir, ".claude", "skills", "taggie", "SKILL.md")));
    await cleanup();
  });

  test("--agent both installs both", async () => {
    execFileSync(process.execPath, [CLI_PATH, "--init-skill", "--agent", "both"], {
      encoding: "utf8",
      cwd: tmpDir,
    });
    await assert.doesNotReject(fs.access(path.join(tmpDir, "AGENTS.md")));
    await assert.doesNotReject(
      fs.access(path.join(tmpDir, ".claude", "skills", "taggie", "SKILL.md"))
    );
    await cleanup();
  });

  test("rejects an unrecognized --agent value", async () => {
    assert.throws(() =>
      execFileSync(process.execPath, [CLI_PATH, "--init-skill", "--agent", "bogus"], {
        encoding: "utf8",
        cwd: tmpDir,
        stdio: ["ignore", "pipe", "pipe"],
      })
    );
    await cleanup();
  });

  test("requires --agent when combined with --yes", async () => {
    assert.throws(() =>
      execFileSync(process.execPath, [CLI_PATH, "--init-skill", "--yes"], {
        encoding: "utf8",
        cwd: tmpDir,
        stdio: ["ignore", "pipe", "pipe"],
      })
    );
    await cleanup();
  });
});

describe("CLI: --yes validation", () => {
  test("requires --by when --template is byline or crafted, instead of printing 'undefined'", async () => {
    assert.throws(() =>
      execFileSync(process.execPath, [CLI_PATH, "--yes", "--for", "X", "--template", "byline"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
    );
  });

  test("byline template with --by set does not contain the literal word 'undefined'", async () => {
    const output = execFileSync(
      process.execPath,
      [CLI_PATH, "--yes", "--for", "X", "--by", "Y", "--template", "byline"],
      { encoding: "utf8" }
    );
    assert.doesNotMatch(output, /undefined/);
    // default emoji (❤️) resolves to a glyph, so it appears in place of
    // the word rather than the spelled-out "love"
    assert.match(output, /Made with ❤ by Y for X/);
  });
});

describe("CLI: --yes --output app (non-interactive auto-detect)", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-cli-app-"));
  });

  const cleanup = () => fs.rm(tmpDir, { recursive: true, force: true });

  test("creates and wires a new Footer component when the detected stack has none", async () => {
    await fs.mkdir(path.join(tmpDir, "app"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0" } })
    );
    await fs.writeFile(
      path.join(tmpDir, "app", "layout.tsx"),
      "export default function RootLayout({ children }) {\n  return (\n    <body>{children}</body>\n  );\n}\n"
    );

    const output = runCli(["--for", "2Nerds", "--emoji", "🔥", "--output", "app"], tmpDir);
    assert.match(output, /created app[\\/]components[\\/]Footer\.jsx and wired it into app[\\/]layout\.tsx/);

    const layout = await fs.readFile(path.join(tmpDir, "app", "layout.tsx"), "utf8");
    assert.match(layout, /import Footer from "\.\/components\/Footer";/);
    assert.match(layout, /<Footer \/>/);

    const footer = await fs.readFile(
      path.join(tmpDir, "app", "components", "Footer.jsx"),
      "utf8"
    );
    // the actual emoji glyph must appear in place of the spelled-out
    // word ("fire"), not the word itself
    assert.match(footer, /Made with 🔥 for 2Nerds/);
    assert.doesNotMatch(footer, /Made with fire for 2Nerds/);
    // the newly-created footer must be centered and theme-aware
    assert.match(footer, /className="taggie-footer"/);
    assert.match(footer, /text-align:\s*center/);
    assert.match(footer, /prefers-color-scheme:\s*dark/);
    await cleanup();
  });

  test("typing the plain word and pasting the glyph produce identical output", async () => {
    await fs.mkdir(path.join(tmpDir, "app"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0" } })
    );
    await fs.writeFile(
      path.join(tmpDir, "app", "layout.tsx"),
      "export default function RootLayout({ children }) {\n  return (\n    <body>{children}</body>\n  );\n}\n"
    );

    runCli(["--for", "X", "--emoji", "fire", "--output", "app"], tmpDir);
    const fromWord = await fs.readFile(
      path.join(tmpDir, "app", "components", "Footer.jsx"),
      "utf8"
    );

    runCli(["--for", "X", "--emoji", "🔥", "--output", "app"], tmpDir);
    const fromGlyph = await fs.readFile(
      path.join(tmpDir, "app", "components", "Footer.jsx"),
      "utf8"
    );

    // the second run replaces the marker block in place (a different code
    // path than the first run's fresh-file creation), so whitespace can
    // differ slightly - what must match is the actual tagline content:
    // both "fire" (word) and 🔥 (glyph) resolve to the same glyph shown
    // in place of the word
    assert.match(fromWord, /Made with 🔥 for X/);
    assert.match(fromGlyph, /Made with 🔥 for X/);
    await cleanup();
  });

  test("injects into an existing footer file when the stack already has one", async () => {
    await fs.mkdir(path.join(tmpDir, "app"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0" } })
    );
    await fs.writeFile(
      path.join(tmpDir, "app", "layout.tsx"),
      "export default function RootLayout({ children }) {\n  return (\n    <body>{children}<footer></footer></body>\n  );\n}\n"
    );

    const output = runCli(["--for", "2Nerds", "--emoji", "❤️", "--output", "app"], tmpDir);
    assert.match(output, /Inserted into footer: app[\\/]layout\.tsx/);

    const layout = await fs.readFile(path.join(tmpDir, "app", "layout.tsx"), "utf8");
    assert.match(layout, /Made with ❤ for 2Nerds/);
    await cleanup();
  });

  test("exits with a clear error when neither a framework nor a footer file can be found", async () => {
    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify({}));
    assert.throws(() => runCli(["--for", "2Nerds", "--output", "app"], tmpDir));
    await cleanup();
  });
});

describe("removeFromFile", () => {
  let tmpDir;
  let originalCwd;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-remove-"));
    process.chdir(tmpDir);
  });

  const cleanup = async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  };

  test("strips the marker block from an html footer, leaving the wrapping <footer> tag", async () => {
    await fs.writeFile(
      "index.html",
      "<body><footer>\n    <!-- taggie -->\n    <p>Made with love for X</p>\n    <!-- /taggie -->\n</footer></body>"
    );
    const result = await removeFromFile("index.html");
    assert.equal(result.status, "removed");
    const content = await fs.readFile("index.html", "utf8");
    assert.doesNotMatch(content, /taggie/);
    assert.doesNotMatch(content, /Made with love for X/);
    assert.match(content, /<footer[\s>]/);
    assert.match(content, /<\/footer>/);
    await cleanup();
  });

  test("strips the marker block from a JSX file using comment-style markers", async () => {
    await fs.writeFile(
      "Footer.jsx",
      'export default function Footer() {\n  return (\n    <footer>\n      {/* taggie */}\n      <p>Made with love for X</p>\n      {/* /taggie */}\n    </footer>\n  );\n}\n'
    );
    const result = await removeFromFile("Footer.jsx");
    assert.equal(result.status, "removed");
    const content = await fs.readFile("Footer.jsx", "utf8");
    assert.doesNotMatch(content, /taggie/);
    assert.match(content, /export default function Footer/);
    await cleanup();
  });

  test("deletes FOOTER.md outright when it's empty after removal", async () => {
    await fs.writeFile("FOOTER.md", "<!-- taggie -->\nMade with love for X\n<!-- /taggie -->\n");
    const result = await removeFromFile("FOOTER.md");
    assert.equal(result.status, "deleted");
    await assert.rejects(fs.access("FOOTER.md"));
    await cleanup();
  });

  test("never auto-deletes README.md, even when the tagline was its only content", async () => {
    await fs.writeFile("README.md", "<!-- taggie -->\nMade with love for X\n<!-- /taggie -->\n");
    const result = await removeFromFile("README.md");
    assert.equal(result.status, "removed");
    await assert.doesNotReject(fs.access("README.md"));
    await cleanup();
  });

  test("preserves surrounding content when removing from a non-empty FOOTER.md/README.md", async () => {
    await fs.writeFile(
      "README.md",
      "# My Project\n\nSome real docs.\n\n<!-- taggie -->\nMade with love for X\n<!-- /taggie -->\n"
    );
    await removeFromFile("README.md");
    const content = await fs.readFile("README.md", "utf8");
    assert.match(content, /# My Project/);
    assert.match(content, /Some real docs\./);
    assert.doesNotMatch(content, /taggie/);
    await cleanup();
  });

  test("returns no-marker status without modifying a file that has no taggie block", async () => {
    await fs.writeFile("plain.html", "<html><body>hello</body></html>");
    const before = await fs.readFile("plain.html", "utf8");
    const result = await removeFromFile("plain.html");
    assert.equal(result.status, "no-marker");
    const after = await fs.readFile("plain.html", "utf8");
    assert.equal(before, after);
    await cleanup();
  });

  test("returns not-found status for a missing file", async () => {
    const result = await removeFromFile("does-not-exist.html");
    assert.equal(result.status, "not-found");
    await cleanup();
  });

  test("update-then-remove: re-adding a tagline and then removing it leaves no trace", async () => {
    await fs.writeFile("index.html", "<body><footer></footer></body>");
    await injectIntoFile("index.html", "Made with love for X");
    await injectIntoFile("index.html", "Made with fire for Y"); // update in place
    let content = await fs.readFile("index.html", "utf8");
    assert.match(content, /Made with fire for Y/);
    assert.doesNotMatch(content, /Made with love for X/);

    await removeFromFile("index.html");
    content = await fs.readFile("index.html", "utf8");
    assert.doesNotMatch(content, /Made with fire for Y/);
    assert.doesNotMatch(content, /taggie/);
    await cleanup();
  });

  test("dry run: would-remove status, file left completely untouched", async () => {
    const original = "<body><footer>\n    <!-- taggie -->\n    <p>Made with love for X</p>\n    <!-- /taggie -->\n</footer></body>";
    await fs.writeFile("index.html", original);
    const result = await removeFromFile("index.html", { dryRun: true });
    assert.equal(result.status, "would-remove");
    const after = await fs.readFile("index.html", "utf8");
    assert.equal(after, original);
    await cleanup();
  });

  test("dry run: would-delete status for an otherwise-empty FOOTER.md, file not actually deleted", async () => {
    const original = "<!-- taggie -->\nMade with love for X\n<!-- /taggie -->\n";
    await fs.writeFile("FOOTER.md", original);
    const result = await removeFromFile("FOOTER.md", { dryRun: true });
    assert.equal(result.status, "would-delete");
    const after = await fs.readFile("FOOTER.md", "utf8");
    assert.equal(after, original);
    await cleanup();
  });
});

describe("findFilesWithMarker", () => {
  let tmpDir;
  let originalCwd;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-scan-"));
    process.chdir(tmpDir);
  });

  const cleanup = async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  };

  test("finds every marked file across mixed extensions, ignoring node_modules", async () => {
    await fs.mkdir("src", { recursive: true });
    await fs.mkdir("node_modules/pkg", { recursive: true });
    await fs.writeFile("index.html", "<!-- taggie -->\nx\n<!-- /taggie -->\n");
    await fs.writeFile("src/App.jsx", "{/* taggie */}\nx\n{/* /taggie */}\n");
    await fs.writeFile("src/Untouched.jsx", "export default function U() { return null; }\n");
    await fs.writeFile(
      "node_modules/pkg/README.md",
      "<!-- taggie -->\nshould be ignored\n<!-- /taggie -->\n"
    );
    const files = await findFilesWithMarker();
    assert.deepEqual(files.sort(), ["index.html", "src/App.jsx"]);
    await cleanup();
  });

  test("returns an empty array when nothing has a taggie marker", async () => {
    await fs.writeFile("index.html", "<html></html>");
    const files = await findFilesWithMarker();
    assert.deepEqual(files, []);
    await cleanup();
  });
});

describe("extractAttributionLine", () => {
  test("extracts the line from HTML/comment-style markers with a <p> wrapper", () => {
    const content = "<footer>\n  <!-- taggie -->\n  <p>Made with love for X</p>\n  <!-- /taggie -->\n</footer>";
    assert.equal(extractAttributionLine(content), "Made with love for X");
  });

  test("extracts the line from JSX comment-style markers with a <p> wrapper", () => {
    const content = "{/* taggie */}\n<p>Crafted with 🔥 by A for B</p>\n{/* /taggie */}";
    assert.equal(extractAttributionLine(content), "Crafted with 🔥 by A for B");
  });

  test("extracts the line from markdown markers with no <p> wrapper", () => {
    const content = "<!-- taggie -->\nMade with ❤️ for X\n<!-- /taggie -->";
    assert.equal(extractAttributionLine(content), "Made with ❤️ for X");
  });

  test("returns null when there is no marker", () => {
    assert.equal(extractAttributionLine("<footer>hi</footer>"), null);
  });
});

describe("checkProject / formatCheckReport / isCheckCompliant", () => {
  let tmpDir;
  let originalCwd;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-check-"));
    process.chdir(tmpDir);
  });

  const cleanup = async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  };

  test("reports no supported framework in an empty/non-web directory", async () => {
    const report = await checkProject();
    assert.equal(report.noFrameworkDetected, true);
    assert.equal(isCheckCompliant(report), false);
    const text = formatCheckReport(report);
    assert.match(text, /No supported framework detected/);
    assert.match(text, /- Plain HTML/);
    await cleanup();
  });

  test("plain HTML with an actual .html file is a supported framework, not 'unsupported'", async () => {
    // static stack alone doesn't mean "no framework" - only static WITH
    // zero html candidates does. A project with a real .html file is
    // plain-HTML-supported, same as the PRD's explicit framework list.
    await fs.writeFile("index.html", "<html><body></body></html>");
    const report = await checkProject();
    assert.equal(report.noFrameworkDetected, false);
    assert.equal(report.frameworkLabel, "HTML");
    assert.equal(report.footerFile, "index.html");
    await cleanup();
  });

  test("reports a detected framework with attribution missing", async () => {
    await fs.mkdir("src", { recursive: true });
    await fs.writeFile("package.json", JSON.stringify({ dependencies: { react: "^18.0.0" } }));
    await fs.writeFile("src/App.jsx", "export default function App() { return <div/>; }");

    const report = await checkProject();
    assert.equal(report.noFrameworkDetected, false);
    assert.equal(report.frameworkLabel, "React");
    assert.equal(report.hasAttribution, false);
    assert.equal(isCheckCompliant(report), false);
    const text = formatCheckReport(report);
    assert.match(text, /Framework: React/);
    assert.match(text, /Taggie attribution: Not found/);
    assert.match(text, /taggie --sync/);
    await cleanup();
  });

  test("reports up to date when attribution exists and no baseline is given", async () => {
    await fs.mkdir("src", { recursive: true });
    await fs.writeFile("package.json", JSON.stringify({ dependencies: { react: "^18.0.0" } }));
    await fs.writeFile(
      "src/App.jsx",
      'export default function App() { return <footer>{/* taggie */}<p>Made with love for X</p>{/* /taggie */}</footer>; }'
    );

    const report = await checkProject();
    assert.equal(report.hasAttribution, true);
    assert.equal(report.attribution, "Made with love for X");
    assert.equal(report.upToDate, null); // no baseline supplied - can't be "outdated"
    assert.equal(isCheckCompliant(report), true);
    const text = formatCheckReport(report);
    assert.match(text, /Status: Up to date/);
    await cleanup();
  });

  test("reports outdated when attribution exists but doesn't match the expected line", async () => {
    await fs.mkdir("src", { recursive: true });
    await fs.writeFile("package.json", JSON.stringify({ dependencies: { react: "^18.0.0" } }));
    await fs.writeFile(
      "src/App.jsx",
      'export default function App() { return <footer>{/* taggie */}<p>Made with love for X</p>{/* /taggie */}</footer>; }'
    );

    const report = await checkProject("Made with fire for X");
    assert.equal(report.upToDate, false);
    assert.equal(isCheckCompliant(report), false);
    const text = formatCheckReport(report);
    assert.match(text, /Status: Outdated/);
    await cleanup();
  });

  test("reports compliant when attribution matches the expected line exactly", async () => {
    await fs.mkdir("src", { recursive: true });
    await fs.writeFile("package.json", JSON.stringify({ dependencies: { react: "^18.0.0" } }));
    await fs.writeFile(
      "src/App.jsx",
      'export default function App() { return <footer>{/* taggie */}<p>Made with love for X</p>{/* /taggie */}</footer>; }'
    );

    const report = await checkProject("Made with love for X");
    assert.equal(report.upToDate, true);
    assert.equal(isCheckCompliant(report), true);
    await cleanup();
  });

  test("never writes anything to the project (read-only)", async () => {
    await fs.mkdir("src", { recursive: true });
    await fs.writeFile("package.json", JSON.stringify({ dependencies: { react: "^18.0.0" } }));
    await fs.writeFile("src/App.jsx", "export default function App() { return <div/>; }");
    const before = await fs.readFile("src/App.jsx", "utf8");
    await checkProject();
    const after = await fs.readFile("src/App.jsx", "utf8");
    assert.equal(before, after);
    await cleanup();
  });
});

describe("CLI: --check", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-cli-check-"));
  });

  const cleanup = () => fs.rm(tmpDir, { recursive: true, force: true });

  test("exits 0 and prints a clean report when attribution is present", async () => {
    await fs.mkdir(path.join(tmpDir, "app"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0" } })
    );
    await fs.writeFile(
      path.join(tmpDir, "app", "layout.tsx"),
      "export default function RootLayout({ children }) {\n  return (\n    <body>{children}</body>\n  );\n}\n"
    );
    runCli(["--for", "2Nerds", "--emoji", "❤️", "--output", "app"], tmpDir);

    const output = execFileSync(process.execPath, [CLI_PATH, "--check"], {
      encoding: "utf8",
      cwd: tmpDir,
    });
    assert.match(output, /Status: Up to date/);
    await cleanup();
  });

  test("exits non-zero when attribution is missing", async () => {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0" } })
    );
    await fs.writeFile(
      path.join(tmpDir, "src", "App.jsx"),
      "export default function App() { return <div/>; }"
    );
    assert.throws(() =>
      execFileSync(process.execPath, [CLI_PATH, "--check"], {
        encoding: "utf8",
        cwd: tmpDir,
        stdio: ["ignore", "pipe", "pipe"],
      })
    );
    await cleanup();
  });

  test("is completely non-interactive - no prompts, works with no other flags", async () => {
    // Regression guard for CI usage: `taggie --check` alone must never
    // hang waiting on stdin, regardless of the project's compliance
    // state (an empty dir is non-compliant and exits 1, which is fine -
    // what matters is it returns promptly with real output, not a hang).
    let output;
    try {
      output = execFileSync(process.execPath, [CLI_PATH, "--check"], {
        encoding: "utf8",
        cwd: tmpDir,
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      output = err.stdout;
    }
    assert.match(output, /Taggie Project Check/);
    await cleanup();
  });

  test("never modifies the project", async () => {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0" } })
    );
    await fs.writeFile(
      path.join(tmpDir, "src", "App.jsx"),
      "export default function App() { return <div/>; }"
    );
    const before = await fs.readFile(path.join(tmpDir, "src", "App.jsx"), "utf8");
    try {
      execFileSync(process.execPath, [CLI_PATH, "--check"], {
        encoding: "utf8",
        cwd: tmpDir,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      // non-zero exit is expected here (no attribution) - only the
      // file-untouched assertion matters
    }
    const after = await fs.readFile(path.join(tmpDir, "src", "App.jsx"), "utf8");
    assert.equal(before, after);
    await cleanup();
  });
});

describe("loadConfig", () => {
  let tmpDir;
  let originalCwd;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-config-"));
    process.chdir(tmpDir);
  });

  const cleanup = async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  };

  test("returns null when taggie.config.json doesn't exist - config is optional", async () => {
    assert.equal(await loadConfig(), null);
    await cleanup();
  });

  test("parses a valid config file", async () => {
    await fs.writeFile(
      "taggie.config.json",
      JSON.stringify({ by: "2Nerds", for: "Acme", emoji: "❤️", template: "byline" })
    );
    const config = await loadConfig();
    assert.deepEqual(config, { by: "2Nerds", for: "Acme", emoji: "❤️", template: "byline" });
    await cleanup();
  });

  test("throws a clear, non-crashing error for malformed JSON", async () => {
    await fs.writeFile("taggie.config.json", "{ not valid json");
    await assert.rejects(() => loadConfig(), /taggie\.config\.json is not valid JSON/);
    await cleanup();
  });
});

describe("resolveProfileFields", () => {
  test("returns empty fields for a null config", () => {
    assert.deepEqual(resolveProfileFields(null), {
      by: undefined,
      for: undefined,
      emoji: undefined,
      template: undefined,
    });
  });

  test("returns the base config fields when there are no profiles", () => {
    const config = { by: "2Nerds", for: "Acme", emoji: "❤️", template: "byline" };
    assert.deepEqual(resolveProfileFields(config), config);
  });

  test("profile fields override the base config fields", () => {
    const config = {
      by: "2Nerds",
      emoji: "❤️",
      template: "byline",
      profiles: {
        opensource: { by: "2Nerds Open Source", emoji: "🚀" },
      },
    };
    const resolved = resolveProfileFields(config, "opensource");
    assert.equal(resolved.by, "2Nerds Open Source");
    assert.equal(resolved.emoji, "🚀");
    // template wasn't overridden by the profile, so the base value carries through
    assert.equal(resolved.template, "byline");
  });

  test("falls back to config.defaultProfile when no profile name is given", () => {
    const config = {
      by: "2Nerds",
      profiles: { opensource: { by: "2Nerds Open Source" } },
      defaultProfile: "opensource",
    };
    assert.equal(resolveProfileFields(config).by, "2Nerds Open Source");
  });

  test("falls back to base fields when the named profile doesn't exist", () => {
    const config = { by: "2Nerds", profiles: {} };
    assert.equal(resolveProfileFields(config, "missing").by, "2Nerds");
  });
});

describe("computeExpectedLine", () => {
  test("returns null when forWhom is missing - not enough information", () => {
    assert.equal(computeExpectedLine({}), null);
  });

  test("returns null for byline/crafted when by is missing", () => {
    assert.equal(computeExpectedLine({ forWhom: "X", template: "byline" }), null);
  });

  test("defaults to the simple template and ❤️ emoji", () => {
    assert.equal(computeExpectedLine({ forWhom: "X" }), "Made with ❤ for X");
  });

  test("builds a byline attribution matching what the CLI would generate", () => {
    assert.equal(
      computeExpectedLine({ forWhom: "X", by: "Y", emoji: "🔥", template: "byline" }),
      "Made with 🔥 by Y for X"
    );
  });
});

describe("CLI: config precedence (--yes)", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-cfg-cli-"));
  });

  const cleanup = () => fs.rm(tmpDir, { recursive: true, force: true });

  test("pulls for/by/emoji/template entirely from config when no CLI flags are given", async () => {
    await fs.mkdir(path.join(tmpDir, "app"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0" } })
    );
    await fs.writeFile(
      path.join(tmpDir, "app", "layout.tsx"),
      "export default function RootLayout({ children }) {\n  return (\n    <body>{children}</body>\n  );\n}\n"
    );
    await fs.writeFile(
      path.join(tmpDir, "taggie.config.json"),
      JSON.stringify({ by: "2Nerds", for: "Acme", emoji: "❤️", template: "byline" })
    );

    // no --for/--by/--emoji/--template - --yes still works without them
    // because config supplies everything, per the PRD's core requirement
    const output = execFileSync(process.execPath, [CLI_PATH, "--yes", "--output", "app"], {
      encoding: "utf8",
      cwd: tmpDir,
    });
    assert.match(output, /Made with ❤ by 2Nerds for Acme/);

    const footer = await fs.readFile(
      path.join(tmpDir, "app", "components", "Footer.jsx"),
      "utf8"
    );
    assert.match(footer, /Made with ❤ by 2Nerds for Acme/);
    await cleanup();
  });

  test("explicit CLI arguments override config values", async () => {
    await fs.mkdir(path.join(tmpDir, "app"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0" } })
    );
    await fs.writeFile(
      path.join(tmpDir, "app", "layout.tsx"),
      "export default function RootLayout({ children }) {\n  return (\n    <body>{children}</body>\n  );\n}\n"
    );
    await fs.writeFile(
      path.join(tmpDir, "taggie.config.json"),
      JSON.stringify({ by: "2Nerds", for: "Acme", emoji: "❤️", template: "byline" })
    );

    const output = execFileSync(
      process.execPath,
      [CLI_PATH, "--yes", "--for", "Override", "--output", "app"],
      { encoding: "utf8", cwd: tmpDir }
    );
    assert.match(output, /for Override/);
    assert.doesNotMatch(output, /for Acme/);
    await cleanup();
  });

  test("works without any config file - existing usage is unaffected", async () => {
    const output = execFileSync(
      process.execPath,
      [CLI_PATH, "--yes", "--for", "2Nerds", "--emoji", "❤️"],
      { encoding: "utf8", cwd: tmpDir }
    );
    assert.match(output, /Made with ❤ for 2Nerds/);
    await cleanup();
  });

  test("exits with a clear error instead of crashing on malformed config", async () => {
    await fs.writeFile(path.join(tmpDir, "taggie.config.json"), "{ broken");
    assert.throws(() =>
      execFileSync(process.execPath, [CLI_PATH, "--yes", "--for", "X"], {
        encoding: "utf8",
        cwd: tmpDir,
        stdio: ["ignore", "pipe", "pipe"],
      })
    );
    await cleanup();
  });
});

describe("CLI: --check uses config as the compliance baseline", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-cfg-check-"));
  });

  const cleanup = () => fs.rm(tmpDir, { recursive: true, force: true });

  test("reports outdated when the live attribution doesn't match config", async () => {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0" } })
    );
    await fs.writeFile(
      path.join(tmpDir, "src", "App.jsx"),
      'export default function App() { return <footer>{/* taggie */}<p>Made with love for Old</p>{/* /taggie */}</footer>; }'
    );
    await fs.writeFile(
      path.join(tmpDir, "taggie.config.json"),
      JSON.stringify({ for: "New" })
    );

    assert.throws(() =>
      execFileSync(process.execPath, [CLI_PATH, "--check"], {
        encoding: "utf8",
        cwd: tmpDir,
        stdio: ["ignore", "pipe", "pipe"],
      })
    );
    await cleanup();
  });

  test("reports up to date when the live attribution matches config exactly", async () => {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0" } })
    );
    await fs.writeFile(
      path.join(tmpDir, "src", "App.jsx"),
      'export default function App() { return <footer>{/* taggie */}<p>Made with ❤ for New</p>{/* /taggie */}</footer>; }'
    );
    await fs.writeFile(
      path.join(tmpDir, "taggie.config.json"),
      JSON.stringify({ for: "New" })
    );

    const output = execFileSync(process.execPath, [CLI_PATH, "--check"], {
      encoding: "utf8",
      cwd: tmpDir,
    });
    assert.match(output, /Status: Up to date/);
    await cleanup();
  });
});

describe("syncProject / formatSyncReport / isSyncSuccess", () => {
  let tmpDir;
  let originalCwd;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-sync-"));
    process.chdir(tmpDir);
  });

  const cleanup = async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  };

  test("returns an error result (not a thrown exception) when there isn't enough info", async () => {
    const result = await syncProject({});
    assert.equal(result.status, "error");
    assert.equal(isSyncSuccess(result), false);
    await cleanup();
  });

  test("adds attribution to a project that has none, wiring a new Footer component", async () => {
    await fs.mkdir("src", { recursive: true });
    await fs.writeFile("package.json", JSON.stringify({ dependencies: { react: "^18.0.0" } }));
    await fs.writeFile("src/App.jsx", "export default function App() { return <div/>; }");

    const result = await syncProject({ forWhom: "Acme", emoji: "❤️" });
    assert.equal(result.status, "added");
    assert.equal(isSyncSuccess(result), true);
    assert.equal(result.rootFile, "src/App.jsx");
    const footer = await fs.readFile(result.footerFile, "utf8");
    assert.match(footer, /Made with ❤ for Acme/);
    await cleanup();
  });

  test("is idempotent - running twice with the same desired attribution changes nothing the second time", async () => {
    await fs.mkdir("src", { recursive: true });
    await fs.writeFile("package.json", JSON.stringify({ dependencies: { react: "^18.0.0" } }));
    await fs.writeFile("src/App.jsx", "export default function App() { return <div/>; }");

    const first = await syncProject({ forWhom: "Acme", emoji: "❤️" });
    const footerAfterFirst = await fs.readFile(first.footerFile, "utf8");

    const second = await syncProject({ forWhom: "Acme", emoji: "❤️" });
    assert.equal(second.status, "up-to-date");
    const footerAfterSecond = await fs.readFile(first.footerFile, "utf8");
    assert.equal(footerAfterFirst, footerAfterSecond); // byte-identical - no rewrite happened
    await cleanup();
  });

  test("updates in place (no duplicates) when the desired attribution changes", async () => {
    await fs.mkdir("src", { recursive: true });
    await fs.writeFile("package.json", JSON.stringify({ dependencies: { react: "^18.0.0" } }));
    await fs.writeFile("src/App.jsx", "export default function App() { return <div/>; }");

    await syncProject({ forWhom: "Acme", emoji: "❤️" });
    const result = await syncProject({ forWhom: "Acme", emoji: "🔥" });
    assert.equal(result.status, "updated");
    const footer = await fs.readFile(result.footerFile, "utf8");
    const matches = footer.match(/Made with/g) ?? [];
    assert.equal(matches.length, 1); // exactly one attribution, not duplicated
    assert.match(footer, /Made with 🔥 for Acme/);
    await cleanup();
  });

  test("preserves unrelated content in the file it updates", async () => {
    await fs.writeFile(
      "index.html",
      "<html><body><header>Welcome</header><footer></footer></body></html>"
    );
    await syncProject({ forWhom: "Acme" });
    const content = await fs.readFile("index.html", "utf8");
    assert.match(content, /<header>Welcome<\/header>/);
    await cleanup();
  });

  test("returns unsafe (not a crash) when nothing can be safely targeted", async () => {
    const result = await syncProject({ forWhom: "Acme" });
    assert.equal(result.status, "unsafe");
    assert.equal(isSyncSuccess(result), false);
    await cleanup();
  });

  test("a failed sync leaves no partial writes behind", async () => {
    // static stack with an html file that has no </body> is the one
    // scenario injectIntoFile itself refuses (no safe insertion point) -
    // syncProject must surface that as "unsafe" without crashing the
    // process, and without touching the file.
    await fs.writeFile("weird.html", "<html><body>no closing tag");
    const before = await fs.readFile("weird.html", "utf8");
    const result = await syncProject({ forWhom: "Acme" });
    assert.equal(isSyncSuccess(result), false);
    const after = await fs.readFile("weird.html", "utf8");
    assert.equal(before, after);
    await cleanup();
  });

  test("formatSyncReport renders each status distinctly", () => {
    assert.match(
      formatSyncReport({ status: "added", framework: "React", footerFile: "src/App.jsx" }),
      /Attribution added/
    );
    assert.match(
      formatSyncReport({ status: "updated", framework: "React", footerFile: "src/App.jsx" }),
      /Attribution updated/
    );
    assert.match(
      formatSyncReport({ status: "up-to-date", framework: "React" }),
      /already up to date/
    );
    assert.match(
      formatSyncReport({ status: "unsafe", message: "Could not safely modify the project." }),
      /No changes were made\./
    );
  });
});

describe("syncProject dry run", () => {
  let tmpDir;
  let originalCwd;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-sync-dry-"));
    process.chdir(tmpDir);
  });

  const cleanup = async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  };

  test("would-add: reports what would happen without creating anything", async () => {
    await fs.mkdir("src", { recursive: true });
    await fs.writeFile("package.json", JSON.stringify({ dependencies: { react: "^18.0.0" } }));
    await fs.writeFile("src/App.jsx", "export default function App() { return <div/>; }");

    const result = await syncProject({ forWhom: "Acme", emoji: "❤️" }, { dryRun: true });
    assert.equal(result.status, "would-add");
    assert.equal(isSyncSuccess(result), true);
    // nothing was actually written: no Footer file created, root file untouched
    await assert.rejects(fs.access(result.footerFile));
    const untouchedApp = await fs.readFile("src/App.jsx", "utf8");
    assert.doesNotMatch(untouchedApp, /Footer/);
    await cleanup();
  });

  test("would-update: reports what would change, leaving the existing attribution untouched", async () => {
    await fs.mkdir("src", { recursive: true });
    await fs.writeFile("package.json", JSON.stringify({ dependencies: { react: "^18.0.0" } }));
    await fs.writeFile("src/App.jsx", "export default function App() { return <div/>; }");
    await syncProject({ forWhom: "Acme", emoji: "❤️" });

    const before = await fs.readFile("src/components/Footer.jsx", "utf8");
    const result = await syncProject({ forWhom: "Acme", emoji: "🔥" }, { dryRun: true });
    assert.equal(result.status, "would-update");
    assert.equal(isSyncSuccess(result), true);
    const after = await fs.readFile("src/components/Footer.jsx", "utf8");
    assert.equal(before, after); // byte-identical - dry run wrote nothing
    await cleanup();
  });

  test("up-to-date stays up-to-date under dry run (no distinct dry-run status when nothing would change)", async () => {
    await fs.mkdir("src", { recursive: true });
    await fs.writeFile("package.json", JSON.stringify({ dependencies: { react: "^18.0.0" } }));
    await fs.writeFile("src/App.jsx", "export default function App() { return <div/>; }");
    await syncProject({ forWhom: "Acme", emoji: "❤️" });

    const result = await syncProject({ forWhom: "Acme", emoji: "❤️" }, { dryRun: true });
    assert.equal(result.status, "up-to-date");
    await cleanup();
  });

  test("formatSyncReport marks would-add/would-update as dry-run, not as done", () => {
    const add = formatSyncReport({ status: "would-add", framework: "React", footerFile: "src/App.jsx" });
    assert.match(add, /would be added/);
    assert.match(add, /dry run/i);
    assert.doesNotMatch(add, /Status: synchronized/);

    const update = formatSyncReport({
      status: "would-update",
      framework: "React",
      footerFile: "src/App.jsx",
    });
    assert.match(update, /would be updated/);
    assert.match(update, /dry run/i);
  });
});

describe("CLI: --sync", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-cli-sync-"));
  });

  const cleanup = () => fs.rm(tmpDir, { recursive: true, force: true });

  test("adds attribution using config alone, non-interactively, no --yes needed", async () => {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0" } })
    );
    await fs.writeFile(
      path.join(tmpDir, "src", "App.jsx"),
      "export default function App() { return <div/>; }"
    );
    await fs.writeFile(
      path.join(tmpDir, "taggie.config.json"),
      JSON.stringify({ by: "2Nerds", for: "Acme", emoji: "❤️", template: "byline" })
    );

    const output = execFileSync(process.execPath, [CLI_PATH, "--sync"], {
      encoding: "utf8",
      cwd: tmpDir,
      timeout: 5000,
    });
    assert.match(output, /Attribution added/);
    const footer = await fs.readFile(
      path.join(tmpDir, "src", "components", "Footer.jsx"),
      "utf8"
    );
    assert.match(footer, /Made with ❤ by 2Nerds for Acme/);
    await cleanup();
  });

  test("--profile selects a named profile", async () => {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0" } })
    );
    await fs.writeFile(
      path.join(tmpDir, "src", "App.jsx"),
      "export default function App() { return <div/>; }"
    );
    await fs.writeFile(
      path.join(tmpDir, "taggie.config.json"),
      JSON.stringify({
        for: "Acme",
        by: "2Nerds",
        template: "byline",
        profiles: { opensource: { by: "2Nerds Open Source", emoji: "🚀" } },
      })
    );

    const output = execFileSync(
      process.execPath,
      [CLI_PATH, "--sync", "--profile", "opensource"],
      { encoding: "utf8", cwd: tmpDir }
    );
    assert.match(output, /Attribution added/);
    const footer = await fs.readFile(
      path.join(tmpDir, "src", "components", "Footer.jsx"),
      "utf8"
    );
    assert.match(footer, /🚀/);
    assert.match(footer, /2Nerds Open Source/);
    await cleanup();
  });

  test("--by overrides config without rewriting taggie.config.json", async () => {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0" } })
    );
    await fs.writeFile(
      path.join(tmpDir, "src", "App.jsx"),
      "export default function App() { return <div/>; }"
    );
    const configJson = JSON.stringify({ for: "Acme", by: "2Nerds", template: "byline" });
    await fs.writeFile(path.join(tmpDir, "taggie.config.json"), configJson);

    execFileSync(
      process.execPath,
      [CLI_PATH, "--sync", "--by", "Temporary Team"],
      { encoding: "utf8", cwd: tmpDir }
    );
    const footer = await fs.readFile(
      path.join(tmpDir, "src", "components", "Footer.jsx"),
      "utf8"
    );
    assert.match(footer, /Temporary Team/);

    const configAfter = await fs.readFile(path.join(tmpDir, "taggie.config.json"), "utf8");
    assert.equal(configAfter, configJson); // untouched
    await cleanup();
  });

  test("exits 0 on success, non-zero when it can't safely sync", async () => {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0" } })
    );
    await fs.writeFile(
      path.join(tmpDir, "src", "App.jsx"),
      "export default function App() { return <div/>; }"
    );

    // no --for and no config - can't determine desired attribution
    assert.throws(() =>
      execFileSync(process.execPath, [CLI_PATH, "--sync"], {
        encoding: "utf8",
        cwd: tmpDir,
        stdio: ["ignore", "pipe", "pipe"],
      })
    );
    await cleanup();
  });

  test("running --sync twice in a row is a no-op the second time (real CLI, not just the unit-level function)", async () => {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0" } })
    );
    await fs.writeFile(
      path.join(tmpDir, "src", "App.jsx"),
      "export default function App() { return <div/>; }"
    );
    await fs.writeFile(
      path.join(tmpDir, "taggie.config.json"),
      JSON.stringify({ for: "Acme" })
    );

    execFileSync(process.execPath, [CLI_PATH, "--sync"], { encoding: "utf8", cwd: tmpDir });
    const output = execFileSync(process.execPath, [CLI_PATH, "--sync"], {
      encoding: "utf8",
      cwd: tmpDir,
    });
    assert.match(output, /already up to date/);
    await cleanup();
  });

  test("--sync --dry-run reports what would happen without writing (real CLI)", async () => {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0" } })
    );
    await fs.writeFile(
      path.join(tmpDir, "src", "App.jsx"),
      "export default function App() { return <div/>; }"
    );
    await fs.writeFile(
      path.join(tmpDir, "taggie.config.json"),
      JSON.stringify({ for: "Acme", emoji: "❤️" })
    );

    const output = execFileSync(process.execPath, [CLI_PATH, "--sync", "--dry-run"], {
      encoding: "utf8",
      cwd: tmpDir,
    });
    assert.match(output, /would be added/);
    assert.match(output, /dry run/i);
    await assert.rejects(fs.access(path.join(tmpDir, "src", "components", "Footer.jsx")));
    await cleanup();
  });
});

describe("syncMultipleProjects / formatMultiSyncReport / isMultiSyncFullySuccessful", () => {
  let tmpDir;
  let originalCwd;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-multi-"));
    process.chdir(tmpDir);
  });

  const cleanup = async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  };

  async function makeReactProject(dir, { config, hasAttribution } = {}) {
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0" } })
    );
    await fs.writeFile(
      path.join(dir, "src", "App.jsx"),
      hasAttribution
        ? 'export default function App() { return <footer>{/* taggie */}<p>Made with ❤ for Acme</p>{/* /taggie */}</footer>; }'
        : "export default function App() { return <div/>; }"
    );
    if (config) {
      await fs.writeFile(path.join(dir, "taggie.config.json"), JSON.stringify(config));
    }
  }

  test("each target is treated independently - one failure doesn't block the others", async () => {
    await makeReactProject("A", { config: { for: "Acme" } });
    await makeReactProject("B", { config: { for: "Acme" }, hasAttribution: true });
    await makeReactProject("C"); // no config, no --for -> will fail
    await fs.writeFile("not-a-dir.txt", "x");

    const results = await syncMultipleProjects(["A", "B", "C", "not-a-dir.txt", "missing"]);
    const byTarget = Object.fromEntries(results.map((r) => [r.target, r.status]));
    assert.equal(byTarget.A, "added");
    assert.equal(byTarget.B, "up-to-date");
    assert.equal(byTarget.C, "skipped");
    assert.equal(byTarget["not-a-dir.txt"], "skipped");
    assert.equal(byTarget.missing, "skipped");
    assert.equal(isMultiSyncFullySuccessful(results), false);
    await cleanup();
  });

  test("a malformed taggie.config.json in one target only skips that target, not the whole run", async () => {
    await makeReactProject("good", { config: { for: "Acme" } });
    await fs.mkdir("bad/src", { recursive: true });
    await fs.writeFile("bad/package.json", JSON.stringify({ dependencies: { react: "^18.0.0" } }));
    await fs.writeFile("bad/src/App.jsx", "export default function App() { return <div/>; }");
    await fs.writeFile("bad/taggie.config.json", "{ invalid json");

    const results = await syncMultipleProjects(["good", "bad"]);
    const byTarget = Object.fromEntries(results.map((r) => [r.target, r.status]));
    assert.equal(byTarget.good, "added");
    assert.equal(byTarget.bad, "skipped");
    const badResult = results.find((r) => r.target === "bad");
    assert.match(badResult.message, /not valid JSON/);
    await cleanup();
  });

  test("restores the working directory after every target, including failed ones", async () => {
    await makeReactProject("A", { config: { for: "Acme" } });
    await fs.mkdir("not-a-dir-target"); // empty dir, no package.json - still "added" via static fallback? guard with no html either
    const before = process.cwd();
    await syncMultipleProjects(["A", "not-a-dir-target", "missing"]);
    assert.equal(process.cwd(), before);
    await cleanup();
  });

  test("never modifies a target it didn't succeed on", async () => {
    await makeReactProject("C"); // will fail: no --for anywhere
    const before = await fs.readFile("C/src/App.jsx", "utf8");
    await syncMultipleProjects(["C"]);
    const after = await fs.readFile("C/src/App.jsx", "utf8");
    assert.equal(before, after);
    await cleanup();
  });

  test("project-root safety - never writes anything outside the target directory", async () => {
    await makeReactProject("proj", { config: { for: "X" } });
    const before = await fs.readdir(".");
    await syncMultipleProjects(["proj"]);
    const after = await fs.readdir(".");
    // the only entries in the parent directory are exactly what existed
    // before the sync ran (plus nothing new) - taggie must not have
    // created/touched any file alongside the target, only inside it
    assert.deepEqual([...after].sort(), [...before].sort());
    await cleanup();
  });

  test("re-running is idempotent across all targets", async () => {
    await makeReactProject("A", { config: { for: "Acme" } });
    await makeReactProject("B", { config: { for: "Acme" } });
    await syncMultipleProjects(["A", "B"]);
    const second = await syncMultipleProjects(["A", "B"]);
    assert.ok(second.every((r) => r.status === "up-to-date"));
    assert.equal(isMultiSyncFullySuccessful(second), true);
    await cleanup();
  });

  test("CLI overrides (for/by/emoji/template/profile) apply uniformly to every target", async () => {
    await makeReactProject("A");
    await makeReactProject("B");
    const results = await syncMultipleProjects(["A", "B"], { forWhom: "Shared" });
    assert.ok(results.every((r) => r.status === "added"));
    const footerA = await fs.readFile("A/src/components/Footer.jsx", "utf8");
    const footerB = await fs.readFile("B/src/components/Footer.jsx", "utf8");
    assert.match(footerA, /for Shared/);
    assert.match(footerB, /for Shared/);
    await cleanup();
  });

  test("dry run applies to every target - nothing is written anywhere", async () => {
    await makeReactProject("A", { config: { for: "Acme" } });
    await makeReactProject("B", { config: { for: "Acme" } });
    const results = await syncMultipleProjects(["A", "B"], {}, { dryRun: true });
    assert.ok(results.every((r) => r.status === "would-add"));
    await assert.rejects(fs.access("A/src/components/Footer.jsx"));
    await assert.rejects(fs.access("B/src/components/Footer.jsx"));
    await cleanup();
  });

  test("formatMultiSyncReport tallies successful and skipped correctly", () => {
    const text = formatMultiSyncReport([
      { target: "A", status: "updated" },
      { target: "B", status: "up-to-date" },
      { target: "C", status: "added" },
      { target: "D", status: "skipped", message: "unsupported structure" },
    ]);
    assert.match(text, /✓ A\s+updated/);
    assert.match(text, /✓ B\s+already up to date/);
    assert.match(text, /✓ C\s+added/);
    assert.match(text, /⚠ D\s+skipped: unsupported structure/);
    assert.match(text, /3 successful/);
    assert.match(text, /1 skipped/);
  });

  test("formatMultiSyncReport marks dry-run statuses distinctly", () => {
    const text = formatMultiSyncReport([
      { target: "A", status: "would-add" },
      { target: "B", status: "would-update" },
    ]);
    assert.match(text, /✓ A\s+would be added \(dry run\)/);
    assert.match(text, /✓ B\s+would be updated \(dry run\)/);
    assert.match(text, /2 successful/);
  });
});

describe("CLI: --sync (multi-project)", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-cli-multi-"));
  });

  const cleanup = () => fs.rm(tmpDir, { recursive: true, force: true });

  test("syncs multiple targets given as positional arguments after --sync", async () => {
    for (const name of ["A", "B"]) {
      const dir = path.join(tmpDir, name);
      await fs.mkdir(path.join(dir, "src"), { recursive: true });
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ dependencies: { react: "^18.0.0" } })
      );
      await fs.writeFile(
        path.join(dir, "src", "App.jsx"),
        "export default function App() { return <div/>; }"
      );
      await fs.writeFile(path.join(dir, "taggie.config.json"), JSON.stringify({ for: name }));
    }

    const output = execFileSync(process.execPath, [CLI_PATH, "--sync", "A", "B"], {
      encoding: "utf8",
      cwd: tmpDir,
    });
    assert.match(output, /Taggie Multi-Project Sync/);
    assert.match(output, /2 successful/);
    await cleanup();
  });

  test("exits non-zero when any target is skipped", async () => {
    await fs.mkdir(path.join(tmpDir, "onlyone"));
    assert.throws(() =>
      execFileSync(process.execPath, [CLI_PATH, "--sync", "onlyone", "does-not-exist"], {
        encoding: "utf8",
        cwd: tmpDir,
        stdio: ["ignore", "pipe", "pipe"],
      })
    );
    await cleanup();
  });

  test("--dry-run applies across all targets (real CLI)", async () => {
    for (const name of ["A", "B"]) {
      const dir = path.join(tmpDir, name);
      await fs.mkdir(path.join(dir, "src"), { recursive: true });
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ dependencies: { react: "^18.0.0" } })
      );
      await fs.writeFile(
        path.join(dir, "src", "App.jsx"),
        "export default function App() { return <div/>; }"
      );
      await fs.writeFile(path.join(dir, "taggie.config.json"), JSON.stringify({ for: name }));
    }

    const output = execFileSync(process.execPath, [CLI_PATH, "--sync", "A", "B", "--dry-run"], {
      encoding: "utf8",
      cwd: tmpDir,
    });
    assert.match(output, /would be added \(dry run\)/);
    await assert.rejects(fs.access(path.join(tmpDir, "A", "src", "components", "Footer.jsx")));
    await assert.rejects(fs.access(path.join(tmpDir, "B", "src", "components", "Footer.jsx")));
    await cleanup();
  });
});

describe("CLI: --remove", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "taggie-cli-remove-"));
  });

  const cleanup = () => fs.rm(tmpDir, { recursive: true, force: true });

  test("--remove --output <file> removes a specific file's tagline", async () => {
    const file = path.join(tmpDir, "FOOTER.md");
    await fs.writeFile(file, "<!-- taggie -->\nMade with love for X\n<!-- /taggie -->\n");
    const output = execFileSync(
      process.execPath,
      [CLI_PATH, "--remove", "--output", "FOOTER.md"],
      { encoding: "utf8", cwd: tmpDir }
    );
    assert.match(output, /Removed FOOTER\.md \(it was empty afterward\)/);
    await assert.rejects(fs.access(file));
    await cleanup();
  });

  test("--remove --dry-run leaves the file completely untouched (real CLI)", async () => {
    const file = path.join(tmpDir, "FOOTER.md");
    const original = "<!-- taggie -->\nMade with love for X\n<!-- /taggie -->\n";
    await fs.writeFile(file, original);
    const output = execFileSync(
      process.execPath,
      [CLI_PATH, "--remove", "--output", "FOOTER.md", "--dry-run"],
      { encoding: "utf8", cwd: tmpDir }
    );
    assert.match(output, /Would remove/);
    assert.match(output, /Dry run, no changes made/);
    const after = await fs.readFile(file, "utf8");
    assert.equal(after, original);
    await cleanup();
  });

  test("--remove with no --output scans and cleans the whole project", async () => {
    await fs.writeFile(
      path.join(tmpDir, "index.html"),
      "<body><footer>\n<!-- taggie -->\n<p>Made with love for X</p>\n<!-- /taggie -->\n</footer></body>"
    );
    const output = execFileSync(process.execPath, [CLI_PATH, "--remove"], {
      encoding: "utf8",
      cwd: tmpDir,
    });
    assert.match(output, /Removed taggie's tagline from index\.html/);
    const content = await fs.readFile(path.join(tmpDir, "index.html"), "utf8");
    assert.doesNotMatch(content, /taggie/);
    await cleanup();
  });

  test("--remove reports nothing to do when the project has no taggie content", async () => {
    const output = execFileSync(process.execPath, [CLI_PATH, "--remove"], {
      encoding: "utf8",
      cwd: tmpDir,
    });
    assert.match(output, /No taggie tagline found anywhere in this project\./);
    await cleanup();
  });

  test("--remove --output <missing file> exits non-zero with a clear error", async () => {
    assert.throws(() =>
      execFileSync(process.execPath, [CLI_PATH, "--remove", "--output", "missing.html"], {
        encoding: "utf8",
        cwd: tmpDir,
        stdio: ["ignore", "pipe", "pipe"],
      })
    );
    await cleanup();
  });

  test("full lifecycle via the real CLI: add, update, remove leaves the project clean", async () => {
    await fs.mkdir(path.join(tmpDir, "app"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0" } })
    );
    await fs.writeFile(
      path.join(tmpDir, "app", "layout.tsx"),
      "export default function RootLayout({ children }) {\n  return (\n    <body>{children}</body>\n  );\n}\n"
    );

    // add (creates + wires a new Footer component)
    runCli(["--for", "2Nerds", "--emoji", "🔥", "--output", "app"], tmpDir);
    let footer = await fs.readFile(path.join(tmpDir, "app", "components", "Footer.jsx"), "utf8");
    assert.match(footer, /Made with 🔥 for 2Nerds/);

    // update (re-running injects into the now-existing footer, in place)
    runCli(["--for", "2Nerds", "--emoji", "❤️", "--output", "app"], tmpDir);
    footer = await fs.readFile(path.join(tmpDir, "app", "components", "Footer.jsx"), "utf8");
    assert.match(footer, /Made with ❤ for 2Nerds/);
    assert.doesNotMatch(footer, /Made with 🔥 for 2Nerds/);

    // remove (project-wide scan finds and cleans the Footer component)
    execFileSync(process.execPath, [CLI_PATH, "--remove"], { encoding: "utf8", cwd: tmpDir });
    footer = await fs.readFile(path.join(tmpDir, "app", "components", "Footer.jsx"), "utf8");
    // the tagline content and its markers are gone - the taggie-footer
    // wrapper class/style block staying behind is expected (removal never
    // deletes the wrapper it doesn't own the customization of)
    assert.doesNotMatch(footer, /<p>/);
    assert.doesNotMatch(footer, /taggie \*\//);
    assert.doesNotMatch(footer, /Made with/);
    // the layout's <Footer /> wiring is left alone - removal never
    // touches component files/imports beyond stripping the marker block
    const layout = await fs.readFile(path.join(tmpDir, "app", "layout.tsx"), "utf8");
    assert.match(layout, /<Footer \/>/);

    await cleanup();
  });
});

describe("resolveGithubToken", () => {
  const ORIGINAL_ENV = { ...process.env };

  test("explicit token wins over any env var", () => {
    process.env.GITHUB_TOKEN = "from-env";
    assert.equal(resolveGithubToken("explicit"), "explicit");
    process.env = { ...ORIGINAL_ENV };
  });

  test("falls back to GITHUB_TOKEN, then GH_TOKEN, then null", () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    assert.equal(resolveGithubToken(undefined), null);

    process.env.GH_TOKEN = "gh-token";
    assert.equal(resolveGithubToken(undefined), "gh-token");

    process.env.GITHUB_TOKEN = "github-token";
    assert.equal(resolveGithubToken(undefined), "github-token");

    process.env = { ...ORIGINAL_ENV };
  });
});

describe("fetchGithubRepos", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  const cleanup = () => {
    globalThis.fetch = originalFetch;
  };

  function fakeRepo(overrides = {}) {
    return {
      name: "repo",
      full_name: "owner/repo",
      clone_url: "https://github.com/owner/repo.git",
      default_branch: "main",
      private: false,
      fork: false,
      archived: false,
      ...overrides,
    };
  }

  test("uses the orgs endpoint and maps the fields taggie needs", async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => [fakeRepo()],
      };
    };

    const repos = await fetchGithubRepos({ owner: "nerds-lab" });
    assert.equal(calls[0].includes("/orgs/nerds-lab/repos"), true);
    assert.deepEqual(repos, [
      {
        name: "repo",
        fullName: "owner/repo",
        cloneUrl: "https://github.com/owner/repo.git",
        defaultBranch: "main",
        private: false,
      },
    ]);
    cleanup();
  });

  test("falls back to the users endpoint when the owner isn't an org", async () => {
    let sawUsersCall = false;
    globalThis.fetch = async (url) => {
      if (url.includes("/orgs/")) return { ok: false, status: 404, json: async () => [] };
      sawUsersCall = true;
      return { ok: true, status: 200, json: async () => [fakeRepo()] };
    };

    const repos = await fetchGithubRepos({ owner: "someuser" });
    assert.equal(sawUsersCall, true);
    assert.equal(repos.length, 1);
    cleanup();
  });

  test("throws a clear error when neither endpoint recognizes the owner", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => [] });
    await assert.rejects(() => fetchGithubRepos({ owner: "ghost" }), /not found/);
    cleanup();
  });

  test("excludes forks and archived repos by default, includes them when asked", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => [
        fakeRepo({ name: "normal" }),
        fakeRepo({ name: "a-fork", fork: true }),
        fakeRepo({ name: "old", archived: true }),
      ],
    });

    const defaultRepos = await fetchGithubRepos({ owner: "org" });
    assert.deepEqual(defaultRepos.map((r) => r.name), ["normal"]);

    const allRepos = await fetchGithubRepos({ owner: "org", includeForks: true, includeArchived: true });
    assert.deepEqual(allRepos.map((r) => r.name).sort(), ["a-fork", "normal", "old"]);
    cleanup();
  });

  test("follows pagination until a short page is returned", async () => {
    let page1 = Array.from({ length: 100 }, (_, i) => fakeRepo({ name: `repo${i}`, full_name: `org/repo${i}` }));
    let page2 = [fakeRepo({ name: "last", full_name: "org/last" })];
    globalThis.fetch = async (url) => {
      const page = new URL(url).searchParams.get("page");
      return { ok: true, status: 200, json: async () => (page === "1" ? page1 : page === "2" ? page2 : []) };
    };

    const repos = await fetchGithubRepos({ owner: "org" });
    assert.equal(repos.length, 101);
    assert.equal(repos.at(-1).name, "last");
    cleanup();
  });
});

describe("formatGithubCheckReport / isGithubCheckFullyCompliant", () => {
  test("reports up-to-date, outdated, missing, no-framework, and skipped repos distinctly", () => {
    const results = [
      {
        repo: "org/up-to-date",
        ok: true,
        report: { noFrameworkDetected: false, hasAttribution: true, upToDate: true, frameworkLabel: "React" },
      },
      {
        repo: "org/outdated",
        ok: true,
        report: {
          noFrameworkDetected: false,
          hasAttribution: true,
          upToDate: false,
          frameworkLabel: "Vue",
          attribution: "Made with love for Old",
        },
      },
      {
        repo: "org/missing",
        ok: true,
        report: { noFrameworkDetected: false, hasAttribution: false, upToDate: null, frameworkLabel: "Next.js" },
      },
      {
        repo: "org/no-framework",
        ok: true,
        report: { noFrameworkDetected: true, hasAttribution: false, upToDate: null },
      },
      { repo: "org/broken", ok: false, message: "couldn't clone: repository not found" },
    ];

    const text = formatGithubCheckReport("org", results);
    assert.match(text, /Taggie GitHub Check: org/);
    assert.match(text, /org\/up-to-date\s+React - up to date/);
    assert.match(text, /org\/outdated\s+Vue - outdated/);
    assert.match(text, /org\/missing\s+Next\.js - missing attribution/);
    assert.match(text, /org\/no-framework\s+no supported framework detected/);
    assert.match(text, /org\/broken\s+skipped: couldn't clone: repository not found/);
    assert.match(text, /1 up to date/);
    assert.match(text, /4 need attention/);

    assert.equal(isGithubCheckFullyCompliant(results), false);
    assert.equal(isGithubCheckFullyCompliant([results[0]]), true);
  });
});

describe("formatGithubSyncReport / isGithubSyncFullySuccessful", () => {
  test("distinguishes already-compliant, newly-pushed, dry-run, and skipped repos", () => {
    const results = [
      { repo: "org/already", status: "up-to-date" },
      { repo: "org/fixed", status: "added", pushed: true },
      { repo: "org/preview", status: "would-update" },
      { repo: "org/broken", status: "skipped", message: "no safe place to add a footer" },
    ];

    const text = formatGithubSyncReport("org", results, { dryRun: false });
    assert.match(text, /Taggie GitHub Sync: org/);
    assert.match(text, /org\/already\s+already up to date/);
    assert.match(text, /org\/fixed\s+added and pushed/);
    assert.match(text, /org\/broken\s+skipped: no safe place to add a footer/);
    assert.match(text, /3 successful/);
    assert.match(text, /1 skipped/);

    const dryRunText = formatGithubSyncReport("org", results, { dryRun: true });
    assert.match(dryRunText, /Dry run - nothing was committed or pushed\./);

    assert.equal(isGithubSyncFullySuccessful(results), false);
    assert.equal(isGithubSyncFullySuccessful(results.slice(0, 3)), true);
  });
});
