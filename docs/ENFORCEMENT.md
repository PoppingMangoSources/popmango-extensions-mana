# Repository checks and their limits

Run `bun install`, `bun run tools`, then `bun run validate --base origin/main` before a
push. Hooks, Test, and both publishing workflows call the same validator. It stops on the
first failing command. There is no `CI` shortcut. Every `scripts/test-*.mjs` file is
discovered and executed automatically, including newly added tests.

The validator compares changed source directories against the supplied base. Pushes use
the previous remote tip; pull requests use the target branch. A local run defaults to
`origin/main`, so fetch that branch first. Source changes shared through `src/common/`
need the affected sources reviewed and versioned as well; identifying affected runtime
behaviour is a review task, not something a filename comparison establishes.

## Automatic gates

| Requirement | Enforcement |
| :--- | :--- |
| Owner author and committer, unsigned, no attribution/session text | Commit-message hook, outgoing-range check, CI; `test-commits.mjs` |
| Canonical agent guide and one shared skill directory | `CLAUDE.md` import and `.agents/skills` symlink checks |
| Skills remain loadable, referenced local documents exist | Skill frontmatter and Markdown link checks |
| Strict typing settings stay enabled | Repository configuration checks and TypeScript compiler |
| No explicit `any`, unavailable globals or direct serialized POST bodies | Source AST checks, including shared code; literals/comments are not mistaken for code |
| Clients are not constructed in host initialization/image methods | Source AST checks |
| Form `optional` is true or absent; no decorative emoji literals | Source AST checks |
| WebView loops use `evaluate` | Source AST checks; dynamic one-shot scripts still need review |
| Removed SDK APIs, setup-method pairing, intent bits and section styles | Source checks and compiler |
| Source catalog includes every Target, with unique identities and languages | Catalog/source checks |
| Packaged thumbnail and README artwork exist | Source checks |
| Every probe has a usable search query | Source checks; live contract chooses a returned title if no fixed id is provided |
| Changed source advances exactly one patch, with matching CHANGELOG heading | Source diff/version checks; mutation tests reject a missing, skipped or minor bump |
| A new source starts at 1.0.0; saved source id stays stable | Source diff checks |
| README and count badge match the built catalog | Generate and compare during validation |
| JavaScript and hook syntax is valid, hooks are executable | Node/shell syntax checks and filesystem modes |
| Workflows are valid, use safe shell inputs, run validation before publishing | Pinned, checksum-verified actionlint; YAML duplicate-key and pipeline checks |
| Publishing and Test cannot conditionally skip the gate or ignore its failure | Workflow structure checks |
| Reader crypto and chapter merging preserve behaviour | Existing fixed-input tests, automatically run by the validator |
| XCOMIC avoids per-title Discover requests and spaced initial loading | Bundle-level request-count, scheduling, preview pagination and refresh tests |
| Empty probe chapter ids cannot silently skip reading | Contract regression test selects a searched title and returned chapter |

`actionlint` runs without its optional external ShellCheck/Pyflakes integrations. CodeQL
also runs independently. Neither is described as a substitute for behaviour tests.

## Live and review requirements

The following rules from the guide, skills, porting map and platform notes need evidence
from the site, a device, or a reviewer. A static checker cannot prove them from prose.

| Requirement | Evidence needed |
| :--- | :--- |
| Endpoints, selectors, fields, filters, sorting and pagination reflect the current site | Live responses through `bun run verify <Name>`, plus filter and next-page cases |
| Every section, language, option and useful capability survives a port | Inventory against the reference and live site; inspect omissions explicitly |
| Home names/order, title pills, info rows, labels and content-rating policy are correct | Request/output assertions where known; visual device review |
| IDs and chapter order preserve library entries and reading progress | Stable fixtures and migration checks, including cross-edition duplicates and extras |
| No N+1 work, unnecessary migration requests, bad cache invalidation or client races | Request traces with concurrent calls; dedicated regression tests for observed failures |
| Locks, coin restrictions and challenge completion reflect real access | Live restricted/unrestricted records; challenge/device tests |
| Image headers, ciphers, redirects, cancellation and retries match the host | Local transport tests, live image requests, first/last page and offline device reads |
| Sign-in/out, redraw, novels and forms work in the actual app | Device checks; the harness has no real WebView or app UI |
| Comments explain useful constraints, shared code is used, no needless abstraction or dependency | Diff review; type/lint checks cannot determine whether a design is justified |
| No unrelated edits, removed supported methods or unintended id/language/rating changes | Review the base-to-head diff and compare the built catalog |

The contract reports each failure and skip. Missing title/chapter data is explicit,
including when the title is chosen from search. A skipped reader or blocked WebView is
unverified. Never report it as a pass. `--strict` makes any skipped step fail the command
when a complete live verification is required.

Keep this inventory aligned when changing the guide or skills: add an executable check
and a regression test for an objectively testable rule; otherwise state the evidence a
reviewer needs. Do not replace semantic rules with regexes that only recognise one spelling.

## Trust boundary

An actor who can edit these checks, remove workflows, disable hooks or bypass repository
rules can defeat repository-owned checks. Server-enforced required checks and review of
changes to the checks themselves are the independent protection. Direct pushes are still
allowed by the repository's existing settings. These gates block publishing on failures;
they do not claim that every sentence in a Markdown file is mechanically provable.
