# vocareum-stats-bookmarklet

A manual tally tool for a paginated Vocareum submissions table, plus the tiny
build step that turns it into a copy/paste bookmarklet.

## Files

| File | Role |
|------|------|
| `table-count-manual.js` | **Source of truth.** Readable, commented. Edit this. |
| `table-count-manual.txt` | **Generated.** The `javascript:void …` bookmarklet. Do not hand-edit. |
| `make-bookmarklet.mjs` | The build step. No dependencies. |

## Installing the bookmarklet

A bookmarklet is just a bookmark whose "URL" is a line of JavaScript. Every
browser can do this, but none of them make it obvious, so the steps are
"create an ordinary bookmark, then paste the code over its address".

First, copy the whole single line from `table-count-manual.txt` — the entire
`javascript:void (function () { … }());` text, no trailing newline.

### Firefox

1. Open the Library with `Ctrl/Cmd+Shift+O` (or **Bookmarks → Manage
   Bookmarks**).
2. Click **Organize → New Bookmark…**.
3. **Name**: `Vocareum tally`. **Location**: paste the `javascript:` line.
4. **Add**.

Alternatively, click the star in the address bar, then **Edit this bookmark**
and replace its **Location** field. If Firefox refuses the pasted `javascript:`
URL there, use the Library route above.

### Chrome / Edge / Brave / Opera

1. Show the bookmarks bar with `Ctrl/Cmd+Shift+B`.
2. Right-click the bar and choose **Add page…**.
3. **Name**: `Vocareum tally`. **URL**: paste the `javascript:` line.
4. **Save**.

The same works from the **Bookmark manager** (`chrome://bookmarks`): open it,
choose **⋮ → Add new bookmark**, and paste the line into the URL field; both
routes accept the `javascript:` scheme.

### Safari

1. Bookmark any page, then open **Bookmarks → Edit Bookmarks**.
2. Select the new bookmark, set its **Name**, and replace its **Address** with
   the copied `javascript:` line. Save.
3. The first time you click it, Safari may ask permission to run JavaScript
   from the address field — allow it.

Mobile browsers generally cannot run bookmarklets at all; desktop Firefox and
Chrome are the most reliable targets.

## Using the bookmarklet

1. Open the submissions page.
2. Click the bookmark.
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

## Testing with the Web Inspector

Test the *unminified* source in DevTools, not the generated file.

1. Open the submissions page, open the Console (`F12` / `Ctrl/Cmd+Shift+I`).
2. Paste all of `table-count-manual.js` in and press Enter. Save it as a
   Snippet (Sources panel in Chrome/Edge, Debugger in Firefox) to re-run with
   `Ctrl/Cmd+Enter` after each edit.
3. Click through **Add this page**, **End of Page**, and **Reset**. Paging on
   and pressing **Add this page** again should raise the total; pressing it
   twice on the same page should not.
4. `window.__rowcounts` gives `{ summary, startedValues, finishedValues, rows }`
   whenever you want the details.

Rebuild when the source behaves, then paste the whole generated `javascript:`
line into the address bar once to confirm the minified version still works.

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
