<template>
  <span class="ost-privacy" data-cy="ost-privacy-indicator">Stored on this device only</span>
</template>

<script setup lang="ts">
/**
 * PLACEHOLDER: the permanent privacy indicator in the top bar (src/ost/shell/TopBar.vue mounts it,
 * right-aligned, with no props). The real component replaces this file: the same short label, and
 * a plain-language explanation of what is stored, what is sent (nothing) and how to check.
 */
</script>

<style scoped>
.ost-privacy {
  font-size: 11.5px;
  color: var(--color-neutral-400);
  white-space: nowrap;
}
</style>
