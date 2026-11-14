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

| What                                                    | Where                              | Leaves the device?    |
| ------------------------------------------------------- | ---------------------------------- | --------------------- |
| The tree you are working on (an autosaved working copy) | This browser's IndexedDB           | No                    |
| Which branches are collapsed                            | This browser's localStorage        | No                    |
| The app's own files, for offline use                    | This browser's cache storage       | No                    |
| Trees you save                                          | `.ost` files wherever you put them | Only if you move them |

Clearing your browsing data removes the working copy, and a private window forgets it when it
closes. **Save a file for anything you want to keep.** If the browser will not store the working
copy at all (storage full or blocked), the indicator in the top bar says "Autosave is off — save a
file".

One honest limit: the site that serves the app (GitHub Pages, or your own server) can see that the
app's files were fetched, as with any web page. It never sees your tree.

## Using it

- **Start**: New tree, Open file, or Load example.
- **Build the tree**: products, outcomes, opportunities, solutions, assumptions and evidence. Add a
  child with the `+` on a node, or drag a type from the palette. Double-click a title to rename.
  Drag a node onto another to move it; Alt+Left / Alt+Right reorders it among its siblings.
- **Details**: select a node to edit its notes and fields, add named links, and (for opportunities)
  keep a list of open questions.
- **Find your way**: search, filter by type, collapse branches, minimap, product picker.
- **Save**: File > Save (Ctrl/Cmd+S) saves to a file on your computer. In Chrome and Edge, Save
  writes back to the file you opened; in Firefox and Safari it downloads a copy. Ctrl/Cmd+O opens a
  file.
- **Export**: File > Export gives PNG, SVG or a Markdown outline.
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
      "type": "product",
      "parentId": null,
      "title": "Meal-planning app",
      "notes": "",
      "status": null,
      "confidence": null,
      "priority": null,
      "valueRating": null,
      "owner": null,
      "sortOrder": 0,
      "archived": false,
      "createdDate": "2026-01-02T03:04:05.000Z",
      "lastModifiedDate": "2026-01-02T03:04:05.000Z",
      "links": [{ "id": 1, "name": "Interview notes", "url": "https://example.com/notes" }],
      "questions": []
    }
  ]
}
```

- `type` is one of `product`, `outcome`, `opportunity`, `solution`, `assumption`, `evidence`.
- `parentId` is the `id` of the parent node, and `null` for a product. `sortOrder` orders siblings.
- `status` applies to opportunities, solutions and assumptions; `priority`, `valueRating` and
  `questions` to opportunities; `confidence` and `owner` to assumptions.

The format is defined in one place, [`src/doc/document.ts`](src/doc/document.ts), which also
validates every file on open. A file that is not in this format is refused with a clear message.
File content is only ever shown as text, and only `http:`, `https:` and `mailto:` links are
clickable.

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
and autosave, `src/export/` the PNG / SVG / Markdown export, `src/privacy/` the privacy indicator,
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
