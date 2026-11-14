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
  (`https://francoisbotha.github.io/ombuto-ost/`), later on a personal site. It must work from
  any sub-path: Vite `base: './'` and **hash-mode** router (or no router at all).
- **One file = one tree.** A `.ost` file is one document holding one tree, which may contain
  several products. No dashboard, no library of trees. New / Open / Save / Save as, plus
  autosave of the current document in the browser so a refresh or crash loses nothing.
- Kept features: the canvas (six node types: product, outcome, opportunity, solution,
  assumption, evidence), palette, add child, rename, move/reorder by drag and keyboard, delete,
  collapse/expand, search, minimap, legend, product picker, detail panel with fields and notes,
  **Links** tab (plain named URLs), **Open questions** tab, and **Export** to PNG, SVG and
  Markdown.
- Removed features: teams, members, roles, sign-in, live collaboration/realtime, chat and
  comments, meeting transcripts, node history, labels/tags, the experiments page, the trees
  dashboard, the team switcher, the full-page node detail view, MCP, admin.
  - Assumption "owner" becomes a plain free-text field (there are no users).
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
  + `@fontsource/inter`. No Bootstrap, no bootstrap-vue-next, no FontAwesome, no rxjs/stomp/
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
    priority, valueRating, owner, sortOrder, archived, createdDate, lastModifiedDate, links
    `[{id,name,url}]`, questions `[{id,text,done}]`. Human-readable (pretty-printed) so the
    file is diff-able and easy for an AI agent to read.
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
  - Warn before closing the tab or opening/creating another document when there are changes
    not yet saved to a file.
  - A first-run experience: an empty state with "New tree", "Open file" and "Load example"
    (a small built-in sample tree, generic product-discovery content).
- App shell: a slim top bar with the document name (editable), a File menu (New, Open, Save,
  Save as, Export ▸ PNG / SVG / Markdown), the dirty/saved state, and the privacy indicator.
  Keyboard: Ctrl/Cmd+S saves, Ctrl/Cmd+O opens.
- **Export** (`src/export/`): no new runtime dependency.
  - SVG: generated directly from the laid-out tree (`domain/layout.ts` gives positions and
    `edgePath`), with colours matching the canvas and text wrapped/truncated to fit node boxes.
    Exports the whole tree for the current product view, ignoring collapse state and viewport.
  - PNG: rasterise that SVG through an offscreen canvas at 2x.
  - Markdown: a nested outline (type, title, status and key fields, notes, links, open
    questions) that reads well in a doc and to an AI agent.
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
