<template>
  <button
    type="button"
    class="ost-privacy ost-hit"
    :class="{ 'is-warning': doc.autosaveFailed }"
    aria-haspopup="dialog"
    :title="doc.autosaveFailed ? AUTOSAVE_OFF_TITLE : 'What is stored, what is sent, and how to check'"
    data-cy="ost-privacy-indicator"
    @click="open = true"
  >
    <component :is="doc.autosaveFailed ? PhWarning : PhShieldCheck" :size="14" aria-hidden="true" />
    <span class="ost-privacy__label">{{ doc.autosaveFailed ? AUTOSAVE_OFF_LABEL : LABEL }}</span>
  </button>
  <!-- Autosave going off is announced once, without moving focus. -->
  <span class="ost-sr-only" role="status" data-cy="ost-privacy-status">{{ doc.autosaveFailed ? AUTOSAVE_OFF_TITLE : '' }}</span>

  <OstDialog v-if="open" title="Your tree stays on this device" width="480px" data-cy="ostPrivacyDialog" @close="open = false">
    <div class="ost-privacy-text">
      <p v-if="doc.autosaveFailed" class="ost-privacy-text__warning" data-cy="ost-privacy-autosave-off">
        <strong>Autosave is off.</strong> This browser is not letting the app keep a working copy: its storage is full or blocked, which is
        usual in a private window. Your tree is still on this device only, but it is gone when this tab closes unless you save it to a file.
      </p>

      <h3>What is stored</h3>
      <p>
        Your tree, and nothing about you.
        <template v-if="doc.autosaveFailed">Normally a working copy is kept in this browser as well; right now it is not.</template>
        <template v-else>
          A working copy is kept in this browser, on this device, and is brought up to date about a second after each change, typing
          included. Reload the page, close the tab or lose power, and the tree comes back the next time you open the app here; at worst the
          last second of typing is missing. Each tab keeps its own working copy.
        </template>
        The files you save are ordinary <code>.ost</code> files on your own computer, to keep, copy or delete as you like.
      </p>

      <h3>What is sent</h3>
      <p>
        Nothing. There is no account, no analytics and no cookies, and there is no server for your tree to go to. The only thing your
        browser ever fetches is the app itself, from the address you opened it at. The site at that address can see that the app was
        fetched, as with any web page; it never sees your tree.
      </p>

      <h3>How to check for yourself</h3>
      <ul>
        <li>Turn off your wifi and keep working. Everything still works, because nothing depends on the network.</li>
        <li>
          Open your browser’s developer tools and watch the Network tab while you edit. Nothing goes out; the most you will see is the app
          loading its own files.
        </li>
        <li>
          Read the source. It is open:
          <a href="https://github.com/FrancoisBotha/ombuto-ost" target="_blank" rel="noopener noreferrer" data-cy="ost-privacy-source"
            >github.com/FrancoisBotha/ombuto-ost</a
          >.
        </li>
      </ul>

      <h3>Keep a file</h3>
      <p>
        The working copy lives in this browser’s own storage. Clearing your browsing data removes it, and a private window forgets it when
        it closes. A tree you want to keep belongs in a file: use File, then Save.
      </p>
    </div>
    <template #actions>
      <button v-if="doc.hasDocument && doc.autosaveFailed" type="button" class="ost-btn" data-cy="ost-privacy-save" @click="save">
        Save to your computer
      </button>
      <button type="button" class="ost-btn ost-btn--primary" data-cy="ost-privacy-close" data-autofocus @click="open = false">Close</button>
    </template>
  </OstDialog>
</template>

<script setup lang="ts">
/**
 * The permanent privacy indicator in the top bar: "Stored on this device only". It opens a
 * plain-language account of what is stored, what is sent (nothing) and how to check that.
 *
 * It also carries the one storage fact the user must act on: when the browser will not keep the
 * working copy (document store `autosaveFailed`), it says so and asks for a save to a file.
 *
 * The dialog returns focus to this button when it closes (OstDialog), and closes on Escape.
 */
import { ref } from 'vue';

import { PhShieldCheck, PhWarning } from '@phosphor-icons/vue';

import { useDocumentStore } from '@/doc/document.store';
import OstDialog from '@/ost/overlays/OstDialog.vue';

const LABEL = 'Stored on this device only';
const AUTOSAVE_OFF_LABEL = 'Autosave is off — save a file';
const AUTOSAVE_OFF_TITLE = 'Autosave is off: this browser is not keeping a working copy. Save your tree to a file.';

const doc = useDocumentStore();
const open = ref(false);

async function save() {
  open.value = false;
  await doc.save();
}
</script>

<style scoped>
.ost-privacy {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 8px;
  font: inherit;
  font-size: 11.5px;
  color: var(--color-neutral-400);
  white-space: nowrap;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
}
.ost-privacy:hover {
  color: var(--color-text);
  border-color: var(--color-neutral-700);
}
.ost-privacy.is-warning {
  color: var(--color-accent-300);
  border-color: var(--color-accent-700);
}

.ost-privacy-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-wrap: pretty;
}
.ost-privacy-text h3 {
  margin-top: 8px;
  font-size: 10px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--color-neutral-500);
}
.ost-privacy-text h3:first-child {
  margin-top: 0;
}
.ost-privacy-text p,
.ost-privacy-text ul {
  margin: 0;
}
.ost-privacy-text ul {
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ost-privacy-text code {
  font-size: 12px;
  color: var(--color-text);
}
.ost-privacy-text a {
  text-decoration: underline;
}
.ost-privacy-text__warning {
  padding: 8px 10px;
  color: var(--color-text);
  border: 1px solid var(--color-accent-700);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
}

/* A narrow top bar keeps the control and drops its words (the title and the dialog still say them). */
@media (max-width: 600px) {
  .ost-privacy__label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
</style>
