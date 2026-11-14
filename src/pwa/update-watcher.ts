/*
 * The service worker: it keeps a copy of the app's own files in this browser so the app opens with
 * no network at all (vite-plugin-pwa generates `sw.js` at build time; it serves those files and
 * nothing else).
 *
 * A new version never replaces the code under an open tree. The new worker installs next to the old
 * one and WAITS; `updateReady` turns true, the shell shows a quiet "Reload" prompt, and only
 * `apply()` (the user's click) lets the new worker take over and reloads the page.
 *
 * Nothing here asks the network for anything: the browser itself looks for a new `sw.js` when the
 * app is opened, and that is the only update check there is.
 */
import { type Ref, ref } from 'vue';

export interface UpdateWatcher {
  /** A newer version of the app is installed and waiting for a reload. */
  updateReady: Ref<boolean>;
  /** Registers the service worker and starts watching for a newer version. Never rejects. */
  start(): Promise<void>;
  /** Switches to the waiting version and reloads the page. */
  apply(): void;
}

type Container = Pick<ServiceWorkerContainer, 'register'>;

/** Relative to the page, so the app works from any folder it is served from. */
export const SERVICE_WORKER_URL = './sw.js';

export function createUpdateWatcher(container: Container, reload: () => void): UpdateWatcher {
  const updateReady = ref(false);
  let registration: ServiceWorkerRegistration | null = null;

  /** A worker waiting behind an active one is an update (on a first visit nothing is active yet). */
  function check() {
    if (registration?.waiting && registration.active) updateReady.value = true;
  }

  function track(worker: ServiceWorker | null) {
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed') check();
    });
  }

  async function start() {
    try {
      registration = await container.register(SERVICE_WORKER_URL);
    } catch {
      // No service worker here (some private windows): the app works as usual while it is online.
      return;
    }
    const current = registration;
    check();
    track(current.installing);
    current.addEventListener('updatefound', () => track(current.installing));
  }

  function apply() {
    const worker = registration?.waiting;
    // Nothing waiting any more: another tab already switched to the new version.
    if (!worker) return reload();
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated' || worker.state === 'redundant') reload();
    });
    // The generated worker takes over only when it is told to (workbox `skipWaiting: false`).
    worker.postMessage({ type: 'SKIP_WAITING' });
  }

  return { updateReady, start, apply };
}

/** The watcher for the running app: only in a production build, and only where the browser has service workers. */
export function appUpdateWatcher(): UpdateWatcher | null {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  return createUpdateWatcher(navigator.serviceWorker, () => window.location.reload());
}
