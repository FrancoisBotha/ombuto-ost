/** Test-only: mounts panel components against a real tree store backed by a stubbed document service. */
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import sinon, { type SinonStubbedInstance } from 'sinon';

import LocalDocumentService from '@/doc/local-document-service';

import { dto } from '../domain/fixtures.test-util';
import type { TreeNodeDTO } from '../ost.model';
import { useOstTreeStore } from '../stores/ost-tree.store';
import { useOstUiStore } from '../stores/ost-ui.store';

export const PANEL_TREE: TreeNodeDTO[] = [
  dto('product-1', null, {
    title: 'Discovery Hub',
    links: [{ id: 1, name: 'Product page', url: 'https://example.com/product-1' }],
  }),
  dto('outcome-1', 'product-1', { title: 'Weekly interviews' }),
  dto('opportunity-1', 'outcome-1', {
    title: 'Hard to find people',
    status: 'EXPLORING',
    priority: 50,
    valueRating: 3,
    links: [
      { id: 11, name: 'Research notes', url: 'https://example.com/research' },
      { id: 12, name: 'Delivery board', url: 'https://example.com/board/DISC-000' },
    ],
    questions: [
      { id: 1, text: 'Who?', done: false },
      { id: 2, text: 'When?', done: true },
      { id: 3, text: 'Why?', done: false },
    ],
  }),
  dto('solution-1', 'opportunity-1', { title: 'In-app invite', status: 'CANDIDATE' }),
  dto('assumption-1', 'solution-1', { title: 'Users accept', status: 'SUPPORTED', confidence: 30, owner: 'Kira P' }),
  dto('assumption-2', 'solution-1', { title: 'Sales agree', status: 'TESTING', confidence: 60 }),
  dto('evidence-1', 'assumption-2', { title: 'Test result' }),
  dto('solution-2', 'opportunity-1', { title: 'Lonely solution', status: 'BUILDING' }),
];

export async function setupStores(nodes: TreeNodeDTO[] = PANEL_TREE) {
  localStorage.clear();
  const pinia = createPinia();
  setActivePinia(pinia);
  const service: SinonStubbedInstance<LocalDocumentService> = sinon.createStubInstance(LocalDocumentService);
  service.getTree.resolves(nodes);
  const tree = useOstTreeStore();
  const ui = useOstUiStore();
  tree.setServiceFactory(() => service);
  await tree.loadTree();
  return { pinia, service, tree, ui };
}

export async function mountWith<T>(component: T, pinia: ReturnType<typeof createPinia>, props: Record<string, unknown> = {}) {
  const wrapper = mount(component as any, { props, attachTo: document.body, global: { plugins: [pinia] } });
  await flushPromises();
  return wrapper;
}
