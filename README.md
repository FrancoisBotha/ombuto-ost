# Ombuto OST

A small, local-first editor for Opportunity Solution Trees. It runs entirely in your browser:
there is no backend, no account and nothing to install. A tree is a file on your own computer.

Use it at <https://francoisbotha.github.io/ombuto-ost/>, or host the static files yourself.

An Opportunity Solution Tree maps a product outcome to the customer opportunities behind it, the
solutions that could address them, and the assumptions each solution rests on. The term and the
technique are Teresa Torres's (see [Credits](#credits)).

## The privacy promise

**Your tree is stored on this device only. Nothing you type is sent anywhere.**

That is the point of the app, so it is enforced rather than promised:

- **There is nowhere to send it.** The app is static files. It has no server, no API, no sign-in,
  no analytics, no cookies, and no third-party scripts, fonts or images (the Inter font is bundled
  with the app).
- **The browser forbids it.** `index.html` carries a strict Content Security Policy:
  `default-src 'self'`, `connect-src 'self'`, `script-src 'self'`, no inline script, no `eval`,
  `form-action 'none'`. Under that policy the page cannot load from, or send to, any other origin,
  whatever a dependency or a future change tries to do.
- **The build checks it.** `npm run build` fails if the built `index.html` lacks the policy, if
  the policy allows any other origin, or if the page, a stylesheet or the web manifest names one
  (`config/csp.ts`).
- **It works offline.** After the first visit a service worker keeps a copy of the app's own files,
  so the app opens and works with no network at all.

### Check it yourself

- Turn off your wifi and keep working.
- Open your browser's developer tools and watch the Network tab while you edit. Nothing goes out;
  the most you will see is the app loading its own files.
- Read the source: it is all here.

### What is stored, and where

| What                                                    | Where                                    | Leaves the device?    |
| ------------------------------------------------------- | ---------------------------------------- | --------------------- |
| The tree you are working on (an autosaved working copy) | This browser's IndexedDB                 | No                    |
| Which branches are collapsed, and which tab is which    | This browser's local and session storage | No                    |
| The app's own files, for offline use                    | This browser's cache storage             | No                    |
| Trees you save                                          | `.ost` files wherever you put them       | Only if you move them |

Clearing your browsing data removes the working copy, and a private window forgets it when it
closes. **Save a file for anything you want to keep.** If the browser will not store the working
copy at all (storage full or blocked), the indicator in the top bar says "Autosave is off — save a
file".

### What the working copy guarantees

- **It follows your typing.** Every change, text still being typed in a field included, reaches
  the working copy about a second later (0.3 s after the last key press, then 0.4 s), and at once
  when the page is hidden, reloaded or closed. Reload, close the tab or lose power, and the tree
  comes back the next time you open the app in this browser. At worst the last second of typing is
  missing after a crash.
- **Each tab has its own.** Two tabs of the app never write over each other. A tab keeps its
  working copy across a reload. Opening the app in a new tab brings back the tree of the tab you
  closed last; if every other copy belongs to a tab that is still open, the new tab starts empty.
  Up to five working copies of closed tabs are kept; older ones are deleted.
- **It is not a file.** The top bar says "Unsaved changes" until the tree is saved to a file, and
  the browser asks before you close a tab with unsaved changes.
- **A copy the app cannot read is kept, not dropped.** The app says so, and offers to save its raw
  contents to your computer.
- **The same file in two tabs.** If you open one `.ost` file in two tabs (Chrome, Edge), each tab
  saves the whole tree. A tab does not overwrite a file that changed since it last read or wrote
  it: it tells you and asks where to save instead.

One honest limit: the site that serves the app (GitHub Pages, or your own server) can see that the
app's files were fetched, as with any web page. It never sees your tree.

## Using it

- **Start**: New tree, Open file, or Open example. File > Open example opens the built-in example at
  any time, as a new unsaved tree.
- **Build the tree**: projects, outcomes, opportunities, solutions, assumptions and evidence. Add a
  child with the `+` on a node, or drag a type from the palette. Double-click a title to rename.
  Drag a node onto another to move it; Alt+Left / Alt+Right reorders it among its siblings.
- **Projects inside projects**: a project holds outcomes and other projects. "+ Project" in the
  toolbar adds a top-level project; the `+` on a project, or Project in the palette, adds a
  sub-project. Drag a project onto another project to nest it, and use "Move to top level" in its
  details to take it back out.
- **Details**: select a node to edit its notes and fields, add named links, and (for opportunities)
  keep a list of open questions.
- **Find your way**: search, filter by type, collapse branches, minimap, and the project picker,
  which shows one project (top-level or nested) with everything under it, or all projects.
- **Save**: File > Save (Ctrl/Cmd+S) saves to a file on your computer. In Chrome and Edge, Save
  writes back to the file you opened and the top bar says "Saved". In Firefox and Safari it
  downloads a copy and the top bar says "Downloaded a copy": a web page cannot see whether a
  download arrived, so check your downloads folder. Ctrl/Cmd+O opens a file.
- **Export**: File > Export gives PNG, SVG or a Markdown outline of what the project picker shows.
  In the outline every project is a heading and a sub-project names the projects it sits in.
- **Install**: your browser's "Install app" puts Ombuto OST in its own window. It works offline
  either way.

When a new version of the app is available, a small prompt offers to reload. The app never reloads
by itself while a tree is open.

## The `.ost` file format

One file is one tree. It is pretty-printed JSON, so it diffs well and is easy to read, for people
and for AI agents:

```json
{
  "format": "ombuto-ost",
  "version": 1,
  "name": "Meal-planning app",
  "nodes": [
    {
      "id": 1,
      "type": "project",
      "parentId": null,
      "title": "Meal-planning app",
      "notes": "",
      "status": null,
      "confidence": null,
      "priority": null,
      "valueRating": null,
      "owner": null,
      "sortOrder": 0,
      "createdDate": "2026-01-02T03:04:05.000Z",
      "lastModifiedDate": "2026-01-02T03:04:05.000Z",
      "links": [{ "id": 1, "name": "Interview notes", "url": "https://example.com/notes" }],
      "questions": []
    }
  ]
}
```

- `type` is one of `project`, `outcome`, `opportunity`, `solution`, `assumption`, `evidence`.
- `parentId` is the `id` of the parent node, and `null` for a top-level project. A project sits at
  the top or under another project, and holds outcomes and projects; an outcome sits under a
  project, an opportunity under an outcome or an opportunity, a solution under an opportunity, an
  assumption under a solution, evidence under an opportunity or an assumption.
- `sortOrder` orders siblings of the same type under one parent.
- `status` applies to opportunities, solutions and assumptions; `priority`, `valueRating` and
  `questions` to opportunities; `confidence` and `owner` to assumptions.

Files saved before projects could nest call a project a `product` (`"type": "product"`). They still
open: a `product` is read as a `project`, and the next save writes `project`. That mapping lives in
[`src/doc/legacy.ts`](src/doc/legacy.ts).

The format is defined in one place, [`src/doc/document.ts`](src/doc/document.ts), which also
validates every file on open. A file that is not in this format is refused with a clear message,
and the tree that was open stays open. File content is only ever shown as text, and only `http:`,
`https:` and `mailto:` links are clickable.

### Limits

The app refuses to open a file beyond these limits, and refuses an edit that would cross one, so
it never saves a file it cannot open again.

| Limit                                  | Value                                                            |
| -------------------------------------- | ---------------------------------------------------------------- |
| Nodes in a tree                        | 1,000                                                            |
| Depth (a top-level project is level 1) | 64 levels                                                        |
| Title                                  | 2 to 200 characters (projects 100, assumptions and evidence 500) |
| Notes                                  | 20,000 characters per node                                       |
| Links, open questions                  | 200 of each per node                                             |
| File size                              | 20 MB                                                            |
| Ids                                    | whole numbers from 1 to 9,007,199,254,740,991                    |

The node limit is a measured one. With 1,000 nodes (headless Chromium on a desktop PC, the built
app) a tree opens in 0.2 to 0.4 s, adding a node takes 0.2 to 0.35 s, a rename 0.1 to 0.2 s, a
pan step about 0.02 s and a key press in the notes under 0.005 s. Only the nodes in view are drawn, so
size on screen is not the cost; the cost of an edit grows with the square of the node count
(2,000 nodes: 0.5 to 0.8 s per added node; 5,000: about 3 s), which is why the limit is where it
is.

## Develop

Needs Node 22.12 or newer.

```sh
npm ci
npm run dev        # dev server on http://localhost:5173
npm run lint       # ESLint + Prettier
npm test           # Vitest
npm run build      # type-check, build into dist/, and run the privacy check
npm run preview    # serve the built dist/ locally
```

The service worker exists only in the built app (`npm run build` then `npm run preview`), not on
the dev server.

Layout: `src/ost/` is the tree editor (canvas, panel, stores), `src/doc/` the document, file access
and autosave (one working copy per tab: `autosave-slots.ts`), `src/export/` the PNG / SVG / Markdown export, `src/privacy/` the privacy indicator,
`src/pwa/` the update prompt, and `config/` the Content Security Policy and the web manifest.

## Host it yourself

`npm run build` produces `dist/`: plain static files, with every address relative. Copy the
folder to any static web server, at the root or in any sub-folder, and open it. Nothing needs
configuring.

- Serve it over **HTTPS** (or from `localhost`). Browsers only allow service workers, and so
  offline use and installing, on a secure origin.
- Let the browser revalidate `sw.js` and `index.html` (do not give them a long cache lifetime), so
  that new versions are noticed. The files under `assets/` have hashed names and can be cached
  for as long as you like.
- The Content Security Policy travels inside `index.html`. If you control the server you can send
  the same policy as an HTTP header too, and add `frame-ancestors 'none'`, which a `<meta>` policy
  cannot express.

This repository deploys itself to GitHub Pages on every push to `main`
(`.github/workflows/deploy.yml`).

## Credits

"Opportunity Solution Tree" is Teresa Torres's term, and the technique is hers, described in her
book _Continuous Discovery Habits_ and at [Product Talk](https://www.producttalk.org/). This
project is an independent implementation. It is not affiliated with, or endorsed by, Teresa Torres
or Product Talk.

Built with Vue, Vue Flow, Pinia, Phosphor Icons and the Inter typeface. See
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Licence

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
