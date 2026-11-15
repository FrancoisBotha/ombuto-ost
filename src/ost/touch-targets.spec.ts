import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { enableAutoUnmount } from '@vue/test-utils';

import { mountWith, setupStores } from './panel/panel.test-util';
import OpenQuestionsTab from './panel/tabs/OpenQuestionsTab.vue';

enableAutoUnmount(afterEach);

const read = (file: string) => readFileSync(`src/ost/${file}`, 'utf8');
const baseCss = read('styles/ost-base.css');

/** On a touch screen the small OST controls are 44 x 44px (ost-base.css, pointer: coarse). */
describe('touch targets', () => {
  it('ost-base.css sizes .ost-tap and .ost-btn to 44px on a coarse pointer only', () => {
    const rule = /@media \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(baseCss)?.[1] ?? '';
    expect(rule).toContain('.ost-root .ost-tap');
    expect(rule).toContain('.ost-root .ost-btn');
    expect(rule).toContain('min-width: 44px');
    expect(rule).toContain('min-height: 44px');
  });

  it('open-question checkbox and remove are touch targets', async () => {
    const ctx = await setupStores();
    ctx.tree.byId('opportunity-1')!.questions = [{ id: 4, text: 'Who books?', done: false }];
    const wrapper = await mountWith(OpenQuestionsTab, ctx.pinia, { nodeKey: 'opportunity-1' });
    expect(wrapper.get('[data-cy="ost-question-toggle-4"]').classes()).toContain('ost-tap');
    expect(wrapper.get('[data-cy="ost-question-remove-4"]').classes()).toContain('ost-tap');
  });

  it('compact controls get an invisible 44px+ hit area on a coarse pointer (.ost-hit), zoom-aware on the canvas', () => {
    const rule = /@media \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(baseCss)?.[1] ?? '';
    expect(rule).toContain('.ost-root .ost-hit::before');
    expect(rule).toContain('max(100%, 48px)');
    expect(rule).toContain('.ost-root .ost-canvas .ost-hit::before');
    expect(rule).toContain('var(--ost-zoom, 1)');
    for (const [file, cls] of [
      ['canvas/OstNode.vue', 'ost-node__add ost-hit'],
      ['canvas/OstNode.vue', 'ost-node__toggle ost-hit'],
      ['canvas/CanvasToolbar.vue', 'ost-toolbar__chip ost-hit'],
      ['panel/fields/StatusChips.vue', 'ost-chip ost-hit'],
      ['panel/PanelTabs.vue', 'ost-tabs__tab ost-hit'],
      ['canvas/NodePalette.vue', 'ost-palette__hide ost-hit'],
      ['canvas/NodePalette.vue', 'ost-palette-rail__open ost-hit'],
      ['canvas/CanvasProjectCombo.vue', 'ost-project-combo__button ost-hit'],
      ['panel/fields/ValueScale.vue', 'ost-value__step ost-hit'],
      ['panel/DetailPanel.vue', 'ost-panel__crumb ost-hit'],
      ['shell/FileMenu.vue', 'ost-file-menu__button ost-hit'],
    ]) {
      expect(read(file), `${file}: ${cls}`).toContain(`class="${cls}`);
    }
  });

  it('the File menu items grow to 44px on a coarse pointer', () => {
    const coarse = /@media \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(read('shell/FileMenu.vue'))?.[1] ?? '';
    expect(coarse).toContain('.ost-file-menu__item');
    expect(coarse).toContain('min-height: 44px');
  });

  it('wrapped rows of compact controls leave room for their hit areas on a coarse pointer', () => {
    const coarse = /@media \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(read('panel/fields/StatusChips.vue'))?.[1] ?? '';
    expect(coarse).toMatch(/row-gap: (2[1-9]|[3-9]\d)px/);
  });
});
