// أسفاري — start: reference data, the saved data, then the app.
import { render } from 'preact';
import { loadCountries } from './core/data.js';
import { loadState } from './core/store.js';
import { tidyPhotos } from './core/photos.js';
import { isNative, cleanOldExports } from './core/native.js';
import { ready } from './ui/app-state.js';
import { App } from './ui/App.jsx';

// the app never runs inside another site's frame (except the private preview, built with ALLOW_FRAME)
if (window.top !== window.self && !__ALLOW_FRAME__) {
  document.documentElement.innerHTML = '';
  throw new Error('framed');
}

(async function boot() {
  const root = document.getElementById('app');
  try {
    await loadCountries();
    await loadState();
    tidyPhotos().catch(() => {});
  } catch (e) {
    console.error(e);
    root.innerHTML = '<div style="padding:32px;font-family:system-ui;text-align:center"><p>تعذّر تشغيل التطبيق. أعد المحاولة.</p><p>The app could not start. Please try again.</p></div>';
    return;
  }
  ready.value = true;
  root.textContent = '';
  render(<App />, root);
  if (!isNative && 'serviceWorker' in navigator && window.isSecureContext && !__ALLOW_FRAME__) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if (isNative) cleanOldExports();
})();
