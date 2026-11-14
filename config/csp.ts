/*
 * The Content Security Policy of the app, and the build check that keeps it honest.
 *
 * The policy is what makes "nothing leaves this device" something the browser enforces rather than
 * something the code promises: with `default-src 'self'` and `connect-src 'self'` the page cannot
 * load from, or send to, any other origin, whatever a dependency or a later change tries to do.
 *
 * It is delivered as a <meta> tag because the app is plain static files with no server to set a
 * header. The tag is written into index.html by `cspPlugin` (for the build and for the dev server),
 * and the build fails when the built index.html lacks it or names another origin.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Plugin } from 'vite';

type Directives = Record<string, string[]>;

/** The policy of the built app. Every source is this origin, or no origin at all. */
export const PRODUCTION_POLICY: Directives = {
  'default-src': ["'self'"],
  // No inline scripts and no eval: only the app's own script files run.
  'script-src': ["'self'"],
  // Only the app's own stylesheets. Vue and Vue Flow set element styles through the DOM
  // (element.style), which a policy does not restrict, so 'unsafe-inline' is not needed.
  'style-src': ["'self'"],
  // data: and blob: are local, not origins: the PNG export draws an SVG through one of them.
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'"],
  // fetch / XHR / WebSocket / beacon: only the app's own files (the service worker caching them).
  'connect-src': ["'self'"],
  'worker-src': ["'self'"],
  'manifest-src': ["'self'"],
  'frame-src': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'none'"],
};

/**
 * The dev server's policy: the same, except that Vite serves styles as inline <style> elements
 * while developing (hot reload). Its websocket is same-origin, which 'self' already covers.
 */
export const DEVELOPMENT_POLICY: Directives = {
  ...PRODUCTION_POLICY,
  'style-src': ["'self'", "'unsafe-inline'"],
};

export const serializePolicy = (policy: Directives): string =>
  Object.entries(policy)
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ');

const META_START = '<meta http-equiv="Content-Security-Policy" content="';
const CHARSET = /<meta charset="[^"]*"\s*\/?>/i;

/** Writes the policy into the page, straight after the charset, before anything can load. */
export function injectPolicy(html: string, policy: Directives): string {
  if (html.includes('Content-Security-Policy')) throw new Error('index.html already has a Content-Security-Policy.');
  if (!CHARSET.test(html)) throw new Error('index.html has no <meta charset> to put the Content-Security-Policy after.');
  return html.replace(CHARSET, charset => `${charset}\n    ${META_START}${serializePolicy(policy)}" />`);
}

/** The policy found in a page, or null. */
export function readPolicy(html: string): Directives | null {
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/i.exec(html);
  if (!match) return null;
  const policy: Directives = {};
  for (const part of match[1].split(';')) {
    const [directive, ...sources] = part.trim().split(/\s+/);
    if (directive) policy[directive] = sources;
  }
  return policy;
}

/** What a source may be: a keyword such as 'self' or 'none', or the local data: / blob: schemes. */
const LOCAL_SOURCE = /^('self'|'none'|data:|blob:)$/;
/** An address on another origin: `http://…`, `https://…`, or protocol-relative `//host`. */
const REMOTE_URL = /https?:\/\/[^\s"'<>)]*|(?<=["'(=\s])\/\/[a-z0-9][^\s"'<>)]*/gi;

/** Every address in `text` that points at another origin. */
export const remoteUrls = (text: string): string[] => text.match(REMOTE_URL) ?? [];

/**
 * What is wrong with a page of the app, in words; empty when it keeps the privacy promise:
 * a policy is present and at least as strict as it must be, nothing in the page points at another
 * origin, and there is no inline script.
 */
export function checkIndexHtml(html: string): string[] {
  const problems: string[] = [];
  const policy = readPolicy(html);
  if (!policy) {
    problems.push('index.html has no Content-Security-Policy <meta>.');
  } else {
    const expectExactly = (directive: string, source: string) => {
      const sources = policy[directive];
      if (!sources || sources.length !== 1 || sources[0] !== source)
        problems.push(
          `The policy must have "${directive} ${source}" (found: ${sources ? sources.join(' ') || 'nothing' : 'no such directive'}).`,
        );
    };
    expectExactly('default-src', "'self'");
    expectExactly('script-src', "'self'");
    expectExactly('connect-src', "'self'");
    expectExactly('object-src', "'none'");
    expectExactly('base-uri', "'self'");
    expectExactly('form-action', "'none'");
    for (const [directive, sources] of Object.entries(policy)) {
      for (const source of sources) {
        // 'unsafe-inline' is tolerated for styles only (the dev server needs it); never for scripts.
        if (source === "'unsafe-inline'" && directive === 'style-src') continue;
        if (!LOCAL_SOURCE.test(source)) problems.push(`The policy allows "${source}" in ${directive}: only this origin may be allowed.`);
      }
    }
  }
  for (const url of remoteUrls(html)) problems.push(`index.html points at another origin: ${url}`);
  for (const script of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\ssrc=/.test(script)) problems.push(`index.html has an inline script (${script}): scripts must be files.`);
  }
  return problems;
}

/** Text files of the built app whose addresses are loaded by the browser, relative to the output folder. */
function loadedTextFiles(dir: string, base = ''): string[] {
  return readdirSync(join(dir, base), { withFileTypes: true }).flatMap(entry => {
    const path = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return loadedTextFiles(dir, path);
    return /\.(css|webmanifest)$/.test(entry.name) ? [path] : [];
  });
}

/** Checks a built app folder: index.html (see `checkIndexHtml`), and no stylesheet or manifest loading from another origin. */
export function checkBuiltApp(outDir: string): string[] {
  const problems = checkIndexHtml(readFileSync(join(outDir, 'index.html'), 'utf8'));
  const policy = readPolicy(readFileSync(join(outDir, 'index.html'), 'utf8'));
  if (policy?.['style-src']?.includes("'unsafe-inline'")) problems.push("The built app must not allow 'unsafe-inline' styles.");
  for (const file of loadedTextFiles(outDir)) {
    for (const url of remoteUrls(readFileSync(join(outDir, file), 'utf8'))) problems.push(`${file} points at another origin: ${url}`);
  }
  return problems;
}

/**
 * Vite plugin: writes the policy into index.html (the strict one when building, the development
 * one on the dev server), and fails the build when the built app does not pass `checkBuiltApp`.
 */
export function cspPlugin(): Plugin {
  let building = false;
  let outDir = 'dist';
  return {
    name: 'ombuto-ost:csp',
    configResolved(config) {
      building = config.command === 'build';
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml(html) {
      return injectPolicy(html, building ? PRODUCTION_POLICY : DEVELOPMENT_POLICY);
    },
    closeBundle() {
      if (!building) return;
      const problems = checkBuiltApp(outDir);
      if (problems.length) throw new Error(`The built app breaks the privacy rules:\n- ${problems.join('\n- ')}`);
    },
  };
}
