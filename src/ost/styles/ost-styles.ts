/*
 * Everything the app needs visually, imported once by the shell (OstShell). Vue Flow's
 * theme-default.css is deliberately not imported (it styles :root); OST nodes are custom.
 * Inter is bundled from @fontsource: no font is ever fetched from another origin.
 */
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@vue-flow/core/dist/style.css';
// The palette itself: the hex lives there once; the tokens below read it.
import './theme.css';
import './ost-tokens.css';
import './ost-base.css';
