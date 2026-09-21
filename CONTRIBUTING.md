# Contributing to taggie-cli

Thanks for wanting to help. taggie is a small tool maintained by [Nerds Lab](https://github.com/nerds-lab-chapter-26), and we're happy to get bug reports, ideas, and pull requests, big or small.

## Ways to help

- **Report a bug.** Open an [issue](https://github.com/nerds-lab-chapter-26/taggie-cli/issues) with what you ran, what you expected, and what happened instead. The output of `taggie --check` and your `package.json` framework (Next.js, React, Vue, Svelte, plain HTML) usually tells us most of what we need.
- **Suggest an improvement.** Open an issue describing the problem you're trying to solve, not just the feature you have in mind. It helps us find the smallest fix.
- **Send a pull request.** For anything bigger than a typo or a small fix, please open an issue first so we can agree on the approach before you spend time on it.

## Getting set up

You need Node.js 18 or newer.

```bash
git clone https://github.com/nerds-lab-chapter-26/taggie-cli.git
cd taggie-cli
npm install
npm link        # optional: makes the local "taggie" command point at your checkout
```

The whole CLI lives in `bin/taggie.js`. Tests are in `test/taggie.test.js`, and `skill/SKILL.md` is the Claude Code skill that `taggie --init-skill` installs.

## Running the tests

```bash
npm test
```

This uses Node's built-in test runner, so there are no extra dev dependencies. Tests build their own throwaway projects in your OS temp directory, so they never touch your real files. Please make sure the full suite passes before opening a pull request.

If you fix a bug, add a test that fails without your fix. If you add a feature, add tests for the normal case and for the case where taggie should refuse to do something.

## Ground rules for changes

taggie edits files in other people's projects, so being careful matters more than being clever. Any change should keep these promises from the README's [Safety](README.md#safety) section:

- Only modify content between taggie's own markers (`<!-- taggie -->...<!-- /taggie -->` or `{/* taggie */}...{/* /taggie */}`).
- When there's no safe place to insert or update something, refuse and say why instead of guessing.
- Never write outside the project root.
- `--check` stays read-only, and `--dry-run` never writes anything.
- Re-running a command should be safe. `--sync` in particular has to stay idempotent.

Other things to keep in mind:

- Existing flags and behavior shouldn't change without a good reason. People use these in CI.
- Keep dependencies to a minimum. If a change needs a new one, explain why in the pull request.
- New behavior that users can see should be documented in the [README](README.md), and in `skill/SKILL.md` if an AI agent would need to know about it.

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Make your change, with tests.
3. Run `npm test`.
4. Add a short entry to [CHANGELOG.md](CHANGELOG.md) if the change is user-visible.
5. Open a pull request that explains what changed and why. Linking the issue helps.

Keep pull requests focused. One fix or feature per PR is much easier to review than a bundle.

Commit messages should be short and say what changed, in the present tense (for example, "Fix --sync skipping Vue projects").

## Code of conduct

Be kind and assume good intent. We want this to be a friendly place to contribute, whether it's your first pull request or your fiftieth.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
