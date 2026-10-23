/* أسفاري — service worker: keeps the web version working fully offline (maps, cities, flags, fonts,
   Excel and PDF engines are all cached on install). Only the app's own files are cached; nothing is
   ever sent anywhere. APPV and ASSETS are written by tools/build.mjs. */
const APPV = '4bcc99eedf18';
const ASSETS = ["./","./index.html","./app.js?v=d2de927b38b2","./apple-touch-icon.png","./data/airports.json","./data/cities.json","./data/countries.json","./data/world-hi.json","./data/world-lo.json","./favicon.png","./flags/ad.svg","./flags/ae.svg","./flags/af.svg","./flags/ag.svg","./flags/ai.svg","./flags/al.svg","./flags/am.svg","./flags/ao.svg","./flags/aq.svg","./flags/ar.svg","./flags/as.svg","./flags/at.svg","./flags/au.svg","./flags/aw.svg","./flags/ax.svg","./flags/az.svg","./flags/ba.svg","./flags/bb.svg","./flags/bd.svg","./flags/be.svg","./flags/bf.svg","./flags/bg.svg","./flags/bh.svg","./flags/bi.svg","./flags/bj.svg","./flags/bl.svg","./flags/bm.svg","./flags/bn.svg","./flags/bo.svg","./flags/bq.svg","./flags/br.svg","./flags/bs.svg","./flags/bt.svg","./flags/bv.svg","./flags/bw.svg","./flags/by.svg","./flags/bz.svg","./flags/ca.svg","./flags/cc.svg","./flags/cd.svg","./flags/cf.svg","./flags/cg.svg","./flags/ch.svg","./flags/ci.svg","./flags/ck.svg","./flags/cl.svg","./flags/cm.svg","./flags/cn.svg","./flags/co.svg","./flags/cr.svg","./flags/cu.svg","./flags/cv.svg","./flags/cw.svg","./flags/cx.svg","./flags/cy.svg","./flags/cz.svg","./flags/de.svg","./flags/dj.svg","./flags/dk.svg","./flags/dm.svg","./flags/do.svg","./flags/dz.svg","./flags/ec.svg","./flags/ee.svg","./flags/eg.svg","./flags/eh.svg","./flags/er.svg","./flags/es.svg","./flags/et.svg","./flags/fi.svg","./flags/fj.svg","./flags/fk.svg","./flags/fm.svg","./flags/fo.svg","./flags/fr.svg","./flags/ga.svg","./flags/gb.svg","./flags/gd.svg","./flags/ge.svg","./flags/gf.svg","./flags/gg.svg","./flags/gh.svg","./flags/gi.svg","./flags/gl.svg","./flags/gm.svg","./flags/gn.svg","./flags/gp.svg","./flags/gq.svg","./flags/gr.svg","./flags/gs.svg","./flags/gt.svg","./flags/gu.svg","./flags/gw.svg","./flags/gy.svg","./flags/hk.svg","./flags/hm.svg","./flags/hn.svg","./flags/hr.svg","./flags/ht.svg","./flags/hu.svg","./flags/id.svg","./flags/ie.svg","./flags/il.svg","./flags/im.svg","./flags/in.svg","./flags/io.svg","./flags/iq.svg","./flags/ir.svg","./flags/is.svg","./flags/it.svg","./flags/je.svg","./flags/jm.svg","./flags/jo.svg","./flags/jp.svg","./flags/ke.svg","./flags/kg.svg","./flags/kh.svg","./flags/ki.svg","./flags/km.svg","./flags/kn.svg","./flags/kp.svg","./flags/kr.svg","./flags/kw.svg","./flags/ky.svg","./flags/kz.svg","./flags/la.svg","./flags/lb.svg","./flags/lc.svg","./flags/li.svg","./flags/lk.svg","./flags/lr.svg","./flags/ls.svg","./flags/lt.svg","./flags/lu.svg","./flags/lv.svg","./flags/ly.svg","./flags/ma.svg","./flags/mc.svg","./flags/md.svg","./flags/me.svg","./flags/mf.svg","./flags/mg.svg","./flags/mh.svg","./flags/mk.svg","./flags/ml.svg","./flags/mm.svg","./flags/mn.svg","./flags/mo.svg","./flags/mp.svg","./flags/mq.svg","./flags/mr.svg","./flags/ms.svg","./flags/mt.svg","./flags/mu.svg","./flags/mv.svg","./flags/mw.svg","./flags/mx.svg","./flags/my.svg","./flags/mz.svg","./flags/na.svg","./flags/nc.svg","./flags/ne.svg","./flags/nf.svg","./flags/ng.svg","./flags/ni.svg","./flags/nl.svg","./flags/no.svg","./flags/np.svg","./flags/nr.svg","./flags/nu.svg","./flags/nz.svg","./flags/om.svg","./flags/pa.svg","./flags/pe.svg","./flags/pf.svg","./flags/pg.svg","./flags/ph.svg","./flags/pk.svg","./flags/pl.svg","./flags/pm.svg","./flags/pn.svg","./flags/pr.svg","./flags/ps.svg","./flags/pt.svg","./flags/pw.svg","./flags/py.svg","./flags/qa.svg","./flags/re.svg","./flags/ro.svg","./flags/rs.svg","./flags/ru.svg","./flags/rw.svg","./flags/sa.svg","./flags/sb.svg","./flags/sc.svg","./flags/sd.svg","./flags/se.svg","./flags/sg.svg","./flags/sh.svg","./flags/si.svg","./flags/sj.svg","./flags/sk.svg","./flags/sl.svg","./flags/sm.svg","./flags/sn.svg","./flags/so.svg","./flags/sr.svg","./flags/ss.svg","./flags/st.svg","./flags/sv.svg","./flags/sx.svg","./flags/sy.svg","./flags/sz.svg","./flags/tc.svg","./flags/td.svg","./flags/tf.svg","./flags/tg.svg","./flags/th.svg","./flags/tj.svg","./flags/tk.svg","./flags/tl.svg","./flags/tm.svg","./flags/tn.svg","./flags/to.svg","./flags/tr.svg","./flags/tt.svg","./flags/tv.svg","./flags/tw.svg","./flags/tz.svg","./flags/ua.svg","./flags/ug.svg","./flags/um.svg","./flags/us.svg","./flags/uy.svg","./flags/uz.svg","./flags/va.svg","./flags/vc.svg","./flags/ve.svg","./flags/vg.svg","./flags/vi.svg","./flags/vn.svg","./flags/vu.svg","./flags/wf.svg","./flags/ws.svg","./flags/xk.svg","./flags/ye.svg","./flags/yt.svg","./flags/za.svg","./flags/zm.svg","./flags/zw.svg","./fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2","./fonts/ibm-plex-sans-arabic-arabic-500-normal.woff2","./fonts/ibm-plex-sans-arabic-arabic-700-normal.woff2","./fonts/ibm-plex-sans-arabic-latin-400-normal.woff2","./fonts/ibm-plex-sans-arabic-latin-500-normal.woff2","./fonts/ibm-plex-sans-arabic-latin-700-normal.woff2","./fonts/ibm-plex-sans-arabic-latin-ext-400-normal.woff2","./fonts/ibm-plex-sans-arabic-latin-ext-500-normal.woff2","./fonts/ibm-plex-sans-arabic-latin-ext-700-normal.woff2","./fonts/pdf/IBMPlexSansArabic-Bold.ttf","./fonts/pdf/IBMPlexSansArabic-Regular.ttf","./fonts/reem-kufi-arabic-500-normal.woff2","./fonts/reem-kufi-arabic-700-normal.woff2","./fonts/reem-kufi-latin-500-normal.woff2","./fonts/reem-kufi-latin-700-normal.woff2","./icon-192.png","./icon-512.png","./icon-maskable-512.png","./manifest.webmanifest","./vendor/exceljs.min.js","./vendor/pdf.js"];
const VERSION = 'asfari-v' + APPV;
const SCOPE = self.registration.scope;
const KNOWN = new Set(ASSETS.map(u => new URL(u, SCOPE).href));

self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(VERSION);
  // fetch in small batches so a slow phone connection is not flooded
  for (let i = 0; i < ASSETS.length; i += 12) {
    await Promise.all(ASSETS.slice(i, i + 12).map(u => c.add(new Request(u, { cache: 'reload' }))));
  }
  await self.skipWaiting();
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('asfari-') && k !== VERSION) await caches.delete(k);
  await self.clients.claim();
})()));

const cacheable = r => r && r.ok && r.type === 'basic';
const fromCache = req => caches.open(VERSION).then(c => c.match(req, { ignoreSearch: false }));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.href.startsWith(SCOPE)) return;
  if (req.mode === 'navigate') {
    // network first so updates arrive; offline, this version's own copy of the page (saved at install
    // together with the files it needs — a newer page is never stored here without them)
    // (a network that hangs — weak signal, hotel Wi-Fi — falls back to it after a few seconds)
    e.respondWith((async () => {
      const net = fetch(req);
      net.catch(() => {}); // a late failure after the cached page was shown is fine
      try {
        return await Promise.race([net, new Promise((_, no) => setTimeout(() => no(new Error('slow')), 4000))]);
      } catch (err) {
        return (await fromCache('./index.html')) || net;
      }
    })());
    return;
  }
  if (!KNOWN.has(url.href)) return;
  e.respondWith(fromCache(req).then(hit => hit || fetch(req).then(r => {
    if (cacheable(r)) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); }
    return r;
  })));
});
