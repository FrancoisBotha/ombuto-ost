# Ombuto OST (lite) — build spec

A very lightweight, local-first Opportunity Solution Tree editor, in the spirit of draw.io:
a static web app with **no backend**. A tree is a document; the document is a file on the
user's own disk. Nothing the user types is ever sent anywhere.

It is a port of the tree editor from the enterprise app at
`C:\dev\build\ombuto-opportunity-solution-tree` (frontend in
`src/main/webapp/app/ost/`, shared CSS in `src/main/webapp/content/`). That repo is
**read-only reference** for this build: never modify it.

## Product decisions (made by the owner)

- Static web app, installable as an offline PWA. Hosted on GitHub Pages first
  (`https://francoisbotha.github.io/ombuto-ost/`) and on Cloudflare Pages (`https://ost.francoisbotha.io/`). It must work from
  any sub-path: Vite `base: './'` and **hash-mode** router (or no router at all).
- **One file = one tree.** A `.ost` file is one document holding one tree, which may contain
  several projects, and projects inside projects. No dashboard, no library of trees. New / Open / Save / Save as, plus
  autosave of the current document in the browser so a refresh, a closed tab or a crash does not
  lose the tree (at worst the last second of typing; see "Autosave" below).
- Kept features: the canvas (six node types: project, outcome, opportunity, solution,
  assumption, evidence), palette, add child, rename, move/reorder by drag and keyboard, delete,
  collapse/expand, search, minimap, legend, project picker, detail panel with fields and notes,
  **Links** tab (plain named URLs), **Open questions** tab, and **Export** to PNG, SVG and
  Markdown.
- Added: **undo / redo** of every change to the tree (document-level history of whole states, at
  most 100 steps, in memory for the tab only, never in the file; `src/doc/history.ts`).
- Removed features: teams, members, roles, sign-in, live collaboration/realtime, chat and
  comments, meeting transcripts, node history, labels/tags, the experiments page, the trees
  dashboard, the team switcher, the full-page node detail view, MCP, admin.
  - Assumption "owner" becomes a plain free-text field (there are no users).
  - The top node type is a **project** (the enterprise app, and the first published build of
    this one, call it a product). **Projects nest**: a project lives at the top of the tree or
    under another project, and holds outcomes and projects, mixed. Everything else is unchanged
    (an outcome only under a project, and so on). A project can never be moved under itself or
    into its own subtree; nested projects count towards the 64-level and 1,000-node limits.
    - One way to each kind: "+ Project" in the toolbar makes a top-level project; the `+` menu
      of a project and the palette's Project card make a sub-project. Dragging a project onto
      another nests it. Dropping a sub-project level with the top-level projects (a drop in a gap of
      any row of same-type nodes places the node there), Alt+Up, or "Move to top level" in its
      `+` menu or the detail panel takes it back out.
    - The project picker lists every project, indented by nesting. Choosing one focuses the
      canvas on that project's subtree (type counts, search, collapse / expand all, minimap, fit
      and export follow it); "All projects" shows everything.
  - Everyone can edit: there is no viewer role. Remove `canEdit` branching where it is simple to
    do so, otherwise hard-wire it to true.
- **No vendor-specific issue-tracker or wiki wording anywhere** (code, UI copy, comments,
  tests, docs). The enterprise app seeds default links named after such tools; the lite app has
  no default links, just "Add link" with a name and a URL.
- Branding: "Ombuto OST". Keep the look of the enterprise canvas (tokens in
  `ost/styles/ost-tokens.css`, `ost-base.css`, and the palette in `content/css/theme.css`).

## Privacy is the product

These are hard requirements, not nice-to-haves:

- No network requests at runtime other than loading the app's own static files. No analytics,
  no CDN, no Google Fonts (fonts are bundled via `@fontsource/inter`), no remote images.
- No `axios`, no `fetch` of anything except same-origin static assets (service worker).
- A strict Content Security Policy `<meta>` in `index.html`: `default-src 'self'`,
  `connect-src 'self'`, no remote origins anywhere. Allow only what the app truly needs
  (`style-src 'self' 'unsafe-inline'` because Vue Flow sets inline styles; `img-src 'self' data:
blob:` for export; `worker-src 'self'`).
- UI wording never says "upload". Use "Open file" and "Save to your computer".
- A permanent, small "Stored on this device only" indicator that opens a plain-language
  explanation: what is stored, what is sent (nothing), and how to check (go offline, or watch
  the browser's Network tab).
- No sign-up, no cookies, no cookie banner.

## Architecture

- Vite + Vue 3 + TypeScript + Pinia + `@vue-flow/core` **pinned at exactly 1.48.2** (the
  canvas's `pinRendered` relies on internal behaviour of that version) + `@phosphor-icons/vue`
  - `@fontsource/inter`. No Bootstrap, no bootstrap-vue-next, no FontAwesome, no rxjs/stomp/
    sockjs, no axios, no js-cookie, no dayjs unless truly needed. Keep dependencies minimal and
    pin exact versions matching the enterprise app's `package.json` where the package is shared.
- Source layout: `src/` with alias `@` -> `src`. The ported module stays at `src/ost/` with
  its sub-folders (`domain/`, `canvas/`, `panel/`, `overlays/`, `stores/`, `styles/`, `pages/`,
  `shell/`) so the code remains comparable with the enterprise app.
- **The seam.** In the enterprise app every server call goes through `ost/ost.service.ts`
  (`OstService`, ~25 axios calls returning DTOs from `ost.model.ts`), and
  `stores/ost-tree.store.ts` (1600 lines) is the only heavy consumer. The port keeps the store's
  shape and replaces the service with a **local document service** that has the same method
  names and promise-returning signatures for the kept operations (load tree, create / patch /
  move / delete node, add / patch / delete link, add / patch / delete question), implemented
  against an in-memory document. This keeps the canvas, panel and store logic close to the
  original and lets the ported specs keep working. Server rules that used to live in Java must
  be reproduced locally: id allocation, `sortOrder` assignment and renumbering on create and
  move, cascade delete of a subtree, allowed parent/child types (`domain/rules.ts` already has
  `ALLOWED` / `canReparent`).
- Strip from the store: realtime (`ost-realtime.store.ts` goes away entirely), request ids and
  echo suppression, team loading and membership, comments, history, transcripts, labels.
- **Document model** (`src/doc/`):
  - File format: JSON, extension `.ost`, shape
    `{ "format": "ombuto-ost", "version": 1, "name": string, "nodes": [...] }` where a node
    carries: id (number, unique in the file), type, parentId, title, notes, status, confidence,
    priority, valueRating, owner, sortOrder, createdDate, lastModifiedDate, links
    `[{id,name,url}]`, questions `[{id,text,done}]`. Human-readable (pretty-printed) so the
    file is diff-able and easy for an AI agent to read.
  - The format stays on version 1. Files and browser working copies written by the first
    published build say `"type": "product"`: on open and on autosave restore that is read as
    `project` (`src/doc/legacy.ts`, the one place for it), and nothing is written with the old
    name again.
  - Strict validation on open: reject files that are not this format with a clear message, and
    never execute or render file content as HTML. Link URLs: only `http:`, `https:` and
    `mailto:` are clickable.
  - A document store (Pinia) tracking: name, dirty flag, file handle (when available), last
    saved time.
  - File access: File System Access API (`showOpenFilePicker` / `showSaveFilePicker`, Save
    writes back to the same file) in Chromium; fallback to `<input type="file">` and a download
    in Firefox / Safari.
  - Autosave: the working document is written (debounced) to IndexedDB and restored on load.
    The file handle is kept in IndexedDB too where the browser allows it.
    - Text being typed in a field reaches the document 0.3 s after the last key press, and at
      once before a save, before the document is replaced, and when the page is hidden or closed
      (`pending-edits.ts`). The autosave follows 0.4 s after a change.
    - One working copy per tab (`autosave-slots.ts`): the slot id lives in `sessionStorage`, the
      tab holds a Web Lock named after it (a localStorage heartbeat where there are no Web Locks).
      On start a tab takes back its own slot, else adopts the most recently changed slot of a
      closed tab, else starts empty. At most five orphaned slots are kept. Collapsed branches are
      kept per slot.
    - A working copy that cannot be read is never deleted or overwritten automatically: the user
      is told and can save its raw contents to a file.
  - Limits (enforced on open and at every edit, so the app never saves a file it cannot open):
    1,000 nodes, 64 levels, 200 links and 200 open questions per node, 20 MB per file. A document
    replaces the open one only after it has been loaded completely.
  - A save that can only download a copy (no save picker) is shown as "Downloaded a copy", not
    "Saved": the app cannot see whether a download arrived.
  - Warn before closing the tab or opening/creating another document when there are changes
    not yet saved to a file.
  - A first-run experience: an empty state with "New tree", "Open file" and "Open example"
    (a built-in example tree, generic product-discovery content: a project with two
    sub-projects, every node type, several statuses, notes, links and open questions). The File
    menu has the same "Open example", through the same replace-document flow as New and Open; the
    example opens as an unsaved document tied to no file.
- App shell: a slim top bar with the document name (editable), a File menu (New, Open, Open
  example, Save, Save as, Export ▸ PNG / SVG / Markdown), the dirty/saved state, and the privacy indicator.
  Keyboard: Ctrl/Cmd+S saves, Ctrl/Cmd+O opens.
- **Export** (`src/export/`): no new runtime dependency.
  - SVG: generated directly from the laid-out tree (`domain/layout.ts` gives positions and
    `edgePath`), with colours matching the canvas and text wrapped/truncated to fit node boxes.
    Exports the whole tree for the current project view (all projects, or the focused project's
    subtree), ignoring collapse state and viewport. Nested projects are drawn like any other
    parent and child.
  - PNG: rasterise that SVG through an offscreen canvas at 2x.
  - Markdown: a nested outline (type, title, status and key fields, notes, links, open
    questions) that reads well in a doc and to an AI agent. Every project is a heading: `##` for
    a top-level (or the focused) project, one level deeper per level of nesting down to `######`.
    A project inside another has a "Sub-project of: A › B" line under its heading, so the nesting
    is unambiguous at any depth. A project's own outcomes come before its sub-projects.
- **PWA**: `vite-plugin-pwa` (Workbox `generateSW`), precaching every built asset so the app
  runs fully offline; web manifest with name, colours and icons (SVG icon plus 192/512 PNG);
  a quiet "new version available — reload" prompt.
- **Deploy**: `.github/workflows/deploy.yml` builds, tests and publishes `dist/` to GitHub
  Pages on push to `main` (official `actions/configure-pages`, `upload-pages-artifact`,
  `deploy-pages`).

## Quality bar

- `npm run build` (includes `vue-tsc` type-check), `npm run lint` and `npm test` (Vitest,
  happy-dom) all pass with no errors.
- Port the enterprise specs that still apply (domain, canvas-model, edit-rules, layout,
  mapping, store, panel tabs) and adapt them; delete specs for removed features. Add specs for
  the local document service (ids, sortOrder, move, cascade delete), file format validation,
  and export.
- No dead code left behind from removed features: no unused components, stores, types, CSS or
  props that only served teams, chat, realtime, transcripts, history or labels.
- Accessibility carried over from the original (keyboard move/reorder, focus handling, touch
  targets).
- Licence: Apache 2.0 (`LICENSE` already in the repo). Add a `NOTICE` and a
  `THIRD-PARTY-NOTICES.md` covering the runtime dependencies actually shipped.

## Working rules for agents

- Work only inside `C:\dev\build\ombuto-ost`. The enterprise repo is read-only.
- Do **not** run `git commit`, `git push` or change git config: the orchestrator commits.
- Windows machine, Node and npm are installed. Use exact dependency versions.
- When your part is done, report: what you built, what you verified (with the command output
  that proves it), and anything left unfinished or that you are unsure about.
