# CLAUDE.md

Guidance for Claude Code and other AI coding agents working in this repository.

Ombuto OST is a local-first Opportunity Solution Tree editor: a static web app with no backend.
A tree is a `.ost` file on the user's own disk. `docs/SPEC.md` is the build spec; `README.md` is the
user-facing description.

## The rule that outranks the others: nothing leaves the device

Privacy is the product. Do not add anything that makes a network request at runtime other than
loading the app's own static files.

- No `fetch` / XHR / WebSocket / beacon to anywhere, no analytics, no error reporting, no CDN, no
  remote fonts or images, no cookies, no sign-in. No `axios`.
- Fonts and icons are bundled (`@fontsource/inter`, `@phosphor-icons/vue`).
- The Content Security Policy lives in `config/csp.ts` and is written into `index.html` at build
  time. Do not loosen it to make something work: no remote origin, no `'unsafe-inline'` or
  `'unsafe-eval'` for scripts, no inline `<script>` in `index.html`. The built app also runs with
  `style-src 'self'`, so do not inject `<style>` elements or `style="…"` markup at runtime (setting
  `element.style` and Vue's `:style` are fine). `npm run build` fails when the built app breaks
  these rules.
- The service worker (`vite-plugin-pwa`, Workbox `generateSW`) precaches the app's own files and
  nothing else. It stays in `registerType: 'prompt'` with `skipWaiting: false`: a new version waits
  for the user to choose Reload (`src/pwa/`), and must never swap code under an open tree.
- UI wording never says "upload". Use "Open file" and "Save to your computer".

## Conventions that matter

- **`@vue-flow/core` is pinned at exactly 1.48.2.** `pinRendered` in
  `src/ost/canvas/canvas-model.ts` keeps a node that is being renamed, or has its `+` menu open,
  rendered by setting its `dragging` flag, which Vue Flow's visibility culling reads as "keep this
  node". That is internal behaviour, not API. Do not bump the version without re-testing renaming
  and the add-child menu on a large tree while panning and zooming.
- **Exact dependency versions** everywhere in `package.json` (no `^` or `~`). Keep runtime
  dependencies minimal, and when one is added, removed or bumped, update
  `THIRD-PARTY-NOTICES.md` (it lists what is actually shipped in `dist/`).
- **The file format lives in `src/doc/document.ts`**: the types, the limits, validation on open
  (`parseDocument` / `validateDocument`) and serialising. Change the format there and nowhere else,
  and keep opening strict: file content is never rendered as HTML, and only `http:`, `https:` and
  `mailto:` links are clickable.
- **The top node type is `project`, and projects nest** (a project sits at the top or under another
  project, and holds outcomes and projects). The first published build called it `product`: files
  and browser working copies from it are mapped on the way in, in `src/doc/legacy.ts` and nowhere
  else. Do not write `product` as a node type anywhere, and do not remove that mapping.
  - The parent -> child matrix is `ALLOWED` in `src/ost/domain/rules.ts`; the document service and
    `validateDocument` both enforce it, together with "no project under its own descendant".
  - Nothing may assume that a project is a root or that the canvas shows whole top-level trees:
    the project picker can focus any project. Ask the tree store (`roots`, `inScope`).
  - Specs that name nodes by id use `src/doc/small-document.test-util.ts`, not the built-in
    example (`src/doc/sample.ts`), so the example can change freely.
- All tree edits go through the local document service (`src/doc/local-document-service.ts`),
  which the tree store (`src/ost/stores/ost-tree.store.ts`) calls. The document store
  (`src/doc/document.store.ts`) owns New / Open / Save and autosave to IndexedDB.
- **Never lose work, never save what cannot be reopened.** Three things keep that true; do not
  work around them:
  - Every limit in `src/doc/document.ts` is checked on open AND enforced by the document service
    at the edit. A new limit goes in both places; `src/doc/service-format-agreement.spec.ts`
    proves they agree.
  - A text field that keeps a draft registers it with `src/doc/pending-edits.ts`
    (`useLiveCommit`). The document store flushes those drafts before it saves, replaces or
    autosaves for the last time, so no entry point has to know which field has the focus.
  - Each tab has its own autosave slot (`src/doc/autosave-slots.ts`). Nothing may write a slot
    another live tab holds, and an unreadable working copy is never deleted without the user
    asking.
- Colours come from the tokens in `src/ost/styles/` (`theme.css` holds the hex values once;
  `ost-tokens.css` assigns the roles). Do not hard-code colours in components.
- Every address is relative (`base: './'`, manifest `scope` and `start_url`): the app must work
  from any sub-path. There is no router.
- "Opportunity Solution Tree" is Teresa Torres's term. This project is not affiliated with
  Product Talk; keep that statement in `README.md` and `NOTICE`.
- Do not name other vendors' issue trackers or wikis anywhere (code, UI copy, comments, tests,
  docs). Links in a tree are plain named URLs.

## Quality commands

All three must pass before a change is done:

```sh
npm run lint     # ESLint + Prettier
npm test         # Vitest (happy-dom)
npm run build    # vue-tsc type-check, Vite build, and the privacy check of dist/
```

Anything that touches the service worker, the Content Security Policy or file access should also be
tried in a real browser against the built app (`npm run build && npm run preview`): load, edit,
save, reload, then again with the network off, watching the console for policy violations.

## Deployment

A push to `main` publishes the app to <https://ost.francoisbotha.io/> (Cloudflare Pages) and to a
GitHub Pages mirror. `docs/DEPLOYMENT.md` has the pipeline, the one-off setup, manual deploys and
what to do when a deploy fails. Read it before touching `.github/workflows/deploy.yml`.
