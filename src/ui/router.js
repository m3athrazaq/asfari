// Hash routes: #/map, #/trips, #/trip/<id>, #/country/KW … The Android back button walks back through them.
import { signal } from '@preact/signals';

const parse = () => {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const parts = path.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch (e) { return s; } });
  return { name: parts[0] || 'map', args: parts.slice(1), query: new URLSearchParams(query) };
};
export const route = signal(parse());
let depth = (history.state && history.state.d) || 0;
addEventListener('popstate', e => { depth = (e.state && e.state.d) || 0; route.value = parse(); });
addEventListener('hashchange', () => { const r = parse(); if (r.name !== route.value.name || r.args.join('/') !== route.value.args.join('/')) route.value = r; });

export const TABS = ['map', 'places', 'trips', 'stats', 'me'];
export const isTab = name => TABS.includes(name);

/** go to a route; replace=true does not add a history entry */
export function go(path, replace = false) {
  const url = '#/' + String(path).replace(/^#?\/?/, '');
  if (url === location.hash) return;
  if (replace) history.replaceState({ d: depth }, '', url);
  else history.pushState({ d: ++depth }, '', url);
  route.value = parse();
  window.scrollTo(0, 0);
}
export function back(fallback = 'map') {
  if (depth > 0) history.back();
  else go(fallback, true);
}
export const canGoBack = () => depth > 0;

/* overlays (sheets, dialogs, photo viewer) close first when the user goes back */
const overlays = [];
export function pushOverlay(close) { overlays.push(close); return () => { const i = overlays.lastIndexOf(close); if (i >= 0) overlays.splice(i, 1); }; }
export function closeTopOverlay() { const f = overlays[overlays.length - 1]; if (f) { f(); return true; } return false; }
