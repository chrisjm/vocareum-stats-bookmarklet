# vocareum-stats-bookmarklet

A manual tally tool for a paginated Vocareum submissions table, plus the tiny
build step that turns it into a copy/paste bookmarklet.

## Files

| File | Role |
|------|------|
| `table-count-manual.js` | **Source of truth.** Readable, commented. Edit this. |
| `table-count-manual.txt` | **Generated.** The `javascript:void …` bookmarklet. Do not hand-edit. |
| `make-bookmarklet.mjs` | The build step. No dependencies. |

## Using the bookmarklet

1. Open the submissions page.
2. Run the bookmarklet — either paste the whole line from
   `table-count-manual.txt` into the address bar, or save it as a bookmark
   whose URL is that line.
3. A small panel appears top-right:
   - **Add this page** — reads the rows currently on screen and accumulates
     them. Pressing it twice on the same page adds nothing (rows are
     de-duplicated).
   - **End of Page** — scrolls to the bottom of the page, where the
     pagination controls usually are.
   - **Reset** — clears the counters.
4. The panel shows **Total**, **Started**, **Finished**, and
   **Currently taking** (Started Y, not Finished Y). No percentage is shown
   because you never see every page, so a percentage would be misleading.

Console detail (`window.__rowcounts`) holds the full breakdown, including the
distinct values seen in each column, backing up the "cells not Y/N" notice.

Privacy: no name is ever stored, printed, or copied. Rows are keyed by an
opaque id or short non-cryptographic hash; state lives in `sessionStorage`
under `rowcounts.v2:<pathname>` and only the fields `{ key, started,
finished }` are persisted.

## Rebuilding the bookmarklet

The source and the bookmarklet must stay in sync. There is no watch mode and
no npm install: `node` plus `make-bookmarklet.mjs` is the whole toolchain, so a
rebuild is byte-for-byte reproducible.

```bash
# regenerate table-count-manual.txt from table-count-manual.js
node make-bookmarklet.mjs table-count-manual.js

# verify it is already up to date; exits non-zero if it is stale
node make-bookmarklet.mjs table-count-manual.js --check

# print to stdout instead of writing, e.g. to pipe somewhere
node make-bookmarklet.mjs table-count-manual.js --stdout
```

Options: `-o <path>` / `--out <path>` chooses the output path (default: the
input path with a `.txt` extension), `--check` verifies without writing,
`--stdout` prints without writing, `-h` prints usage.

The generator strips comments, collapses whitespace outside string/template/
regex literals to single spaces, wraps the result as `javascript:void <code>`,
and then runs `node --check` on it — so it refuses to write a bookmarklet that
does not parse. It never renames identifiers, reorders anything, or deletes a
newline, so automatic semicolon insertion behaves exactly as it did in the
source. The input must be a single expression (it is: one IIFE).

## Git

If you ever wire up CI or a pre-commit hook, `node make-bookmarklet.mjs
table-count-manual.js --check` is the guard that keeps `table-count-manual.txt`
in sync with its source.
