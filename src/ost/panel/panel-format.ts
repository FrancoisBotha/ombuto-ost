/* Small presentation helpers for the detail panel: copy, thresholds and DOM ids. */
import type { PanelTab } from '../domain/derive';

/** The five confidence steps of the assumption control. */
export const CONFIDENCE_STEPS = [20, 40, 60, 80, 100];

export const confidenceLabel = (c: number) => (c >= 80 ? 'High confidence' : c >= 60 ? 'Med-high' : c >= 40 ? 'Medium' : 'Low');

/** What a link URL must look like (see rules.isSafeLinkUrl), in words for the user. */
export const LINK_URL_RULE = 'Links must start with http://, https:// or mailto:.';

/** "No assumption tests …" / "3 assumption tests · 1 supported · 1 refuted. …" */
export function evidenceNote(e: { tests: number; supported: number; refuted: number }) {
  if (e.tests === 0) {
    return 'No assumption tests under this solution yet — add the assumptions you would have to believe for it to work.';
  }
  return `${e.tests} assumption test${e.tests === 1 ? '' : 's'} · ${e.supported} supported · ${e.refuted} refuted. Rolled up from the tests below, not set by hand.`;
}

/** DOM ids tying the panel's tabs to their tab panel (aria-controls / aria-labelledby). */
export const tabDomId = (tab: PanelTab) => `ost-panel-tab-${tab}`;
export const tabPanelDomId = (tab: PanelTab) => `ost-panel-tabpanel-${tab}`;
