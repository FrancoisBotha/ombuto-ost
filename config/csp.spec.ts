import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DEVELOPMENT_POLICY, PRODUCTION_POLICY, checkIndexHtml, injectPolicy, readPolicy, remoteUrls, serializePolicy } from './csp';
import { LICENCE_FILES } from './licences';
import { APP_COLOUR, manifest } from './manifest';

const indexHtml = readFileSync('index.html', 'utf8');
const built = injectPolicy(indexHtml, PRODUCTION_POLICY);

describe('Content Security Policy', () => {
  it('lets the built app load from, and talk to, its own origin only', () => {
    expect(serializePolicy(PRODUCTION_POLICY)).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; " +
        "worker-src 'self'; manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'",
    );
  });

  it('allows no inline script, no eval and no inline style in the built app', () => {
    const text = serializePolicy(PRODUCTION_POLICY);
    expect(text).not.toContain('unsafe-inline');
    expect(text).not.toContain('unsafe-eval');
    expect(text).not.toContain('*');
  });

  it('the dev server differs only by inline styles (Vite serves styles inline while developing)', () => {
    const differing = Object.keys(PRODUCTION_POLICY).filter(d => PRODUCTION_POLICY[d].join(' ') !== DEVELOPMENT_POLICY[d].join(' '));
    expect(differing).toEqual(['style-src']);
    expect(DEVELOPMENT_POLICY['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(Object.keys(DEVELOPMENT_POLICY)).toEqual(Object.keys(PRODUCTION_POLICY));
  });

  it('is written into index.html straight after the charset, before anything loads', () => {
    expect(readPolicy(indexHtml)).toBeNull();
    expect(readPolicy(built)).toEqual(PRODUCTION_POLICY);
    const head = built.slice(0, built.indexOf('<meta name="viewport"'));
    expect(head).toMatch(/<meta charset="UTF-8" \/>\s*<meta http-equiv="Content-Security-Policy" content="default-src 'self';/);
    expect(built.indexOf('Content-Security-Policy')).toBeLessThan(built.indexOf('<link'));
    expect(built.indexOf('Content-Security-Policy')).toBeLessThan(built.indexOf('<script'));
  });

  it('refuses a page that already has a policy, or has nowhere to put one', () => {
    expect(() => injectPolicy(built, PRODUCTION_POLICY)).toThrow(/already has/);
    expect(() => injectPolicy('<html><head></head></html>', PRODUCTION_POLICY)).toThrow(/charset/);
  });
});

describe('the page keeps the privacy promise (checkIndexHtml)', () => {
  it('passes the real index.html, with either policy', () => {
    expect(checkIndexHtml(built)).toEqual([]);
    expect(checkIndexHtml(injectPolicy(indexHtml, DEVELOPMENT_POLICY))).toEqual([]);
  });

  it('the source index.html names no other origin and has no inline script', () => {
    expect(remoteUrls(indexHtml)).toEqual([]);
    expect(indexHtml.match(/<script\b[^>]*>/g)).toEqual(['<script type="module" src="/src/main.ts">']);
  });

  it('fails when the policy is missing', () => {
    expect(checkIndexHtml(indexHtml)).toEqual(['index.html has no Content-Security-Policy <meta>.']);
  });

  it.each([
    [
      'a stylesheet from a font service',
      '<link rel="stylesheet" href="https://fonts.example.com/css?family=Inter" />',
      'https://fonts.example.com/css?family=Inter',
    ],
    ['a script from a CDN', '<script src="http://cdn.example.com/lib.js"></script>', 'http://cdn.example.com/lib.js'],
    ['a protocol-relative image', '<img src="//images.example.com/pixel.gif" />', '//images.example.com/pixel.gif'],
    ['a preconnect hint', '<link rel="preconnect" href="https://example.com">', 'https://example.com'],
  ])('fails when the page loads %s', (_what, tag, url) => {
    const problems = checkIndexHtml(built.replace('</head>', `${tag}</head>`));
    expect(problems).toContain(`index.html points at another origin: ${url}`);
  });

  it('fails on an inline script', () => {
    const problems = checkIndexHtml(built.replace('</head>', '<script>window.x = 1</script></head>'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('inline script');
  });

  it.each([
    ['a remote origin in connect-src', { 'connect-src': ["'self'", 'https://api.example.com'] }],
    ['a scheme wildcard for images', { 'img-src': ["'self'", 'https:'] }],
    ['a wildcard', { 'default-src': ['*'] }],
    ['eval', { 'script-src': ["'self'", "'unsafe-eval'"] }],
    ['inline scripts', { 'script-src': ["'self'", "'unsafe-inline'"] }],
    ['objects', { 'object-src': ["'self'"] }],
    ['form posts', { 'form-action': ["'self'"] }],
  ])('fails when the policy allows %s', (_what, change) => {
    const html = injectPolicy(indexHtml, { ...PRODUCTION_POLICY, ...change });
    expect(checkIndexHtml(html).length).toBeGreaterThan(0);
  });

  it('fails when a directive the promise rests on is dropped', () => {
    for (const directive of ['default-src', 'script-src', 'connect-src', 'object-src', 'base-uri', 'form-action']) {
      const policy = { ...PRODUCTION_POLICY };
      delete policy[directive];
      expect(checkIndexHtml(injectPolicy(indexHtml, policy)).join(' ')).toContain(directive);
    }
  });
});

describe('web app manifest', () => {
  const themeCss = readFileSync('src/ost/styles/theme.css', 'utf8');

  it('is named Ombuto OST and takes its colour from the app palette', () => {
    expect(manifest.name).toBe('Ombuto OST');
    expect(themeCss).toContain(`--ost-nocturne-ground: ${APP_COLOUR};`);
    expect(manifest.background_color).toBe(APP_COLOUR);
    expect(manifest.theme_color).toBe(APP_COLOUR);
    expect(indexHtml).toContain(`<meta name="theme-color" content="${APP_COLOUR}" />`);
  });

  it('is relative throughout, so the installed app works from any folder', () => {
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.id).toBe('./');
    for (const icon of manifest.icons ?? []) expect(icon.src).toMatch(/^icons\/[a-z0-9-]+\.(svg|png)$/);
    expect(remoteUrls(JSON.stringify(manifest))).toEqual([]);
  });

  it('has an SVG icon, 192 and 512 PNG icons and a maskable one, and every file exists', () => {
    const icons = manifest.icons ?? [];
    expect(icons.map(i => `${i.sizes} ${i.type} ${i.purpose}`)).toEqual([
      'any image/svg+xml any',
      '192x192 image/png any',
      '512x512 image/png any',
      '512x512 image/png maskable',
    ]);
    for (const icon of icons) expect(existsSync(`public/${icon.src}`), icon.src).toBe(true);
    for (const file of ['favicon.ico', 'apple-touch-icon.png', '.nojekyll']) expect(existsSync(`public/${file}`), file).toBe(true);
  });

  it('PNG icons really have the size they claim', () => {
    for (const icon of (manifest.icons ?? []).filter(i => i.type === 'image/png')) {
      const png = readFileSync(`public/${icon.src}`);
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.src).toBe(icon.sizes);
    }
    const apple = readFileSync('public/apple-touch-icon.png');
    expect([apple.readUInt32BE(16), apple.readUInt32BE(20)]).toEqual([180, 180]);
  });
});

describe('licence files', () => {
  it('are shipped with the built app, and each exists', () => {
    expect(LICENCE_FILES).toEqual(['LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.md']);
    for (const file of LICENCE_FILES) expect(existsSync(file), file).toBe(true);
    expect(readFileSync('vite.config.ts', 'utf8')).toContain('licenceFilesPlugin()');
  });

  it('the notices name every runtime dependency in package.json, at its version', () => {
    const notices = readFileSync('THIRD-PARTY-NOTICES.md', 'utf8');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> };
    for (const [name, version] of Object.entries(pkg.dependencies)) {
      const row = notices.split('\n').find(line => line.startsWith('|') && line.includes('`' + name + '`'));
      expect(row, name).toBeDefined();
      expect(row, name).toContain(version);
    }
  });
});

describe('vite.config.ts', () => {
  const config = readFileSync('vite.config.ts', 'utf8');

  it('never lets a new version take over an open tree by itself', () => {
    expect(config).toContain("registerType: 'prompt'");
    expect(config).toContain('skipWaiting: false');
    expect(config).toContain('clientsClaim: false');
    expect(config).not.toMatch(/registerType:\s*'autoUpdate'/);
  });

  it('injects no registration script into the page, and keeps every address relative', () => {
    expect(config).toContain('injectRegister: false');
    expect(config).toContain("base: './'");
  });

  it('precaches every kind of file the build emits, fonts included', () => {
    expect(config).toContain("globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}']");
  });
});
