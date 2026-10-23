// The world map on a <canvas>: a flat map (Miller projection) you pinch and drag, or a globe you spin.
// Knows nothing about the app's data: the screen gives it a colour for each country, markers and pins.
import { geoPath, geoProjection, geoOrthographic, geoContains, geoGraticule10, geoDistance, geoBounds, geoArea } from 'd3-geo';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';
import { select } from 'd3-selection';

function millerRaw(lambda, phi) { return [lambda, 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * phi))]; }
millerRaw.invert = (x, y) => [x, 2.5 * Math.atan(Math.exp(0.8 * y)) - 0.625 * Math.PI];

const W = 1024;                         // world width in map units
const LAT_MAX = 84;                     // the flat map shows 84°N … 84°S
const S0 = W / (2 * Math.PI);
const YMAX = 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * LAT_MAX * Math.PI / 180)) * S0;
const H = 2 * YMAX;                     // world height in map units
const ease = t => 1 - Math.pow(1 - t, 3);
const DPR = () => Math.min(3, window.devicePixelRatio || 1);

export class WorldMap {
  constructor(canvas, { features, featuresLo, onTap, onLongPress, onView } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onTap = onTap || (() => {});
    this.onLongPress = onLongPress || (() => {});
    this.onView = onView || (() => {});
    this.mode = 'flat';
    this.proj = geoProjection(millerRaw).scale(S0).translate([W / 2, H / 2]).precision(0.2);
    this.style = { fill: () => '#ddd', markers: [], pins: [], labels: true, colors: {} };
    this.t = zoomIdentity;
    this.globe = { lambda: -30, phi: 20, z: 1 };
    this.anim = null;
    this.raf = 0;
    this.setFeatures(features, featuresLo);
    this.zoom = d3zoom()
      .scaleExtent([1, 120])
      .filter(ev => (ev.type === 'wheel' || !ev.button) && !(ev.type === 'dblclick'))
      .on('zoom', ev => { this.t = ev.transform; this.request(); this.onView(this.view()); });
    this.sel = select(canvas);
    this.bindPointer();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.setMode('flat');
  }

  /* ---------------- data ---------------- */
  setFeatures(features, featuresLo) {
    this.features = features || [];
    this.featuresLo = featuresLo || this.features;
    const path = geoPath(this.proj);
    for (const f of this.features) {
      const d = path(f);
      f.p2d = d ? new Path2D(d) : null;
      f.wb = d ? path.bounds(f) : null;
      if (!f.bbox2) f.bbox2 = geoBounds(f);
      f.area = geoArea(f);
    }
    // borders between countries, drawn once as one path
    const all = new Path2D();
    for (const f of this.features) if (f.p2d) all.addPath(f.p2d);
    this.allPath = all;
    this.request();
  }
  setStyle(style) { this.style = { ...this.style, ...style }; this.request(); }

  /* ---------------- size & view ---------------- */
  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return; // hidden (another tab is open): keep the view as it is
    const w = Math.round(r.width), h = Math.round(r.height);
    const dpr = DPR();
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    const center = this.w ? this.centerLonLat() : null;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.fit = Math.max(w / W, h / H);
    this.zoom.extent([[0, 0], [w, h]]).translateExtent([[0, 0], [W * this.fit, H * this.fit]]);
    if (this.mode === 'flat' && center) this.centerOn(center[0], center[1], this.t.k, false);
    this.request();
  }
  /** flat map: lon/lat → screen px */
  toScreen(lon, lat) {
    const p = this.proj([lon, lat]);
    if (!p) return null;
    const s = this.t.k * this.fit;
    return [p[0] * s + this.t.x, p[1] * s + this.t.y];
  }
  toLonLat(x, y) {
    if (this.mode === 'globe') {
      const ll = this.globeProj().invert([x, y]);
      if (!ll || !isFinite(ll[0])) return null;
      const c = [-this.globe.lambda, -this.globe.phi];
      return geoDistance(ll, c) <= Math.PI / 2 ? ll : null;
    }
    const s = this.t.k * this.fit;
    const ll = this.proj.invert([(x - this.t.x) / s, (y - this.t.y) / s]);
    return ll && isFinite(ll[0]) ? ll : null;
  }
  centerLonLat() {
    if (this.mode === 'globe') return [-this.globe.lambda, -this.globe.phi];
    return this.toLonLat(this.w / 2, this.h / 2) || [0, 20];
  }
  view() { return { mode: this.mode, k: this.mode === 'globe' ? this.globe.z : this.t.k, center: this.centerLonLat() }; }
  /** centre the flat map on a point at zoom k */
  centerOn(lon, lat, k = this.t.k, animate = true) {
    if (this.mode === 'globe') return this.spinTo(lon, lat, k);
    const p = this.proj([lon, lat]);
    const s = k * this.fit;
    const t = zoomIdentity.translate(this.w / 2 - p[0] * s, this.h / 2 - p[1] * s).scale(k);
    this.go(t, animate);
  }
  /** zoom so a country fills the view */
  zoomToCountry(cc, animate = true) {
    const f = this.features.find(x => x.id === cc);
    if (this.mode === 'globe') {
      const c = f ? f.bbox2 : null;
      const lp = this.style.labelPoint ? this.style.labelPoint(cc) : null;
      if (lp) this.spinTo(lp[1], lp[0], Math.min(6, Math.max(1.2, f ? 1 / Math.sqrt(Math.max(f.area, 1e-5)) / 2.4 : 4)));
      return;
    }
    let b = f && f.wb;
    if (!b || b[1][0] - b[0][0] > W * 0.6) {
      // tiny or wraps around the date line: centre on its label point
      const lp = this.style.labelPoint ? this.style.labelPoint(cc) : null;
      if (!lp) return;
      const k = f && f.area > 0.02 ? 2.5 : 18;
      return this.centerOn(lp[1], lp[0], k, animate);
    }
    this.fitWorldBox(b, animate);
  }
  fitWorldBox(b, animate = true, pad = 0.18) {
    const bw = Math.max(2, b[1][0] - b[0][0]), bh = Math.max(2, b[1][1] - b[0][1]);
    let k = Math.min(this.w * (1 - pad * 2) / (bw * this.fit), this.h * (1 - pad * 2) / (bh * this.fit));
    k = Math.max(1, Math.min(60, k));
    const s = k * this.fit;
    const cx = (b[0][0] + b[1][0]) / 2, cy = (b[0][1] + b[1][1]) / 2;
    this.go(zoomIdentity.translate(this.w / 2 - cx * s, this.h / 2 - cy * s).scale(k), animate);
  }
  /** fit a set of lon/lat points */
  fitPoints(points, animate = true) {
    if (!points.length) return this.go(zoomIdentity, animate);
    const ps = points.map(([lon, lat]) => this.proj([lon, lat])).filter(Boolean);
    const xs = ps.map(p => p[0]), ys = ps.map(p => p[1]);
    let b = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
    const padW = Math.max(30, (b[1][0] - b[0][0]) * 0.15), padH = Math.max(20, (b[1][1] - b[0][1]) * 0.15);
    b = [[b[0][0] - padW, b[0][1] - padH], [b[1][0] + padW, b[1][1] + padH]];
    this.fitWorldBox(b, animate, 0.05);
  }
  zoomBy(f) {
    if (this.mode === 'globe') { this.globe.z = Math.max(0.8, Math.min(8, this.globe.z * f)); this.request(); this.onView(this.view()); return; }
    const k = Math.max(1, Math.min(120, this.t.k * f));
    const c = [this.w / 2, this.h / 2];
    const p = [(c[0] - this.t.x) / this.t.k, (c[1] - this.t.y) / this.t.k];
    this.go(zoomIdentity.translate(c[0] - p[0] * k, c[1] - p[1] * k).scale(k), true);
  }
  go(target, animate) {
    cancelAnimationFrame(this.goRaf);
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { this.zoom.transform(this.sel, target); return; }
    const from = this.t, t0 = performance.now(), dur = 520;
    // zoom out a bit and back in when the move is long, like a flight
    const step = now => {
      const u = Math.min(1, (now - t0) / dur), e = ease(u);
      const k = from.k * Math.pow(target.k / from.k, e);
      // interpolate the centre in map units so the move looks straight
      const c0 = [(this.w / 2 - from.x) / from.k, (this.h / 2 - from.y) / from.k];
      const c1 = [(this.w / 2 - target.x) / target.k, (this.h / 2 - target.y) / target.k];
      const cx = c0[0] + (c1[0] - c0[0]) * e, cy = c0[1] + (c1[1] - c0[1]) * e;
      this.zoom.transform(this.sel, zoomIdentity.translate(this.w / 2 - cx * k, this.h / 2 - cy * k).scale(k));
      if (u < 1) this.goRaf = requestAnimationFrame(step);
    };
    this.goRaf = requestAnimationFrame(step);
  }

  /* ---------------- globe ---------------- */
  globeProj() {
    const r = Math.min(this.w, this.h) / 2 * 0.9 * this.globe.z;
    return geoOrthographic().rotate([this.globe.lambda, this.globe.phi]).scale(r).translate([this.w / 2, this.h / 2]).clipAngle(90).precision(0.6);
  }
  spinTo(lon, lat, z = this.globe.z) {
    cancelAnimationFrame(this.spinRaf);
    const from = { ...this.globe }, to = { lambda: -lon, phi: Math.max(-70, Math.min(70, -lat)), z };
    let dl = to.lambda - from.lambda; dl = ((dl + 540) % 360) - 180;
    const t0 = performance.now(), dur = 700;
    const step = now => {
      const u = Math.min(1, (now - t0) / dur), e = ease(u);
      this.globe = { lambda: from.lambda + dl * e, phi: from.phi + (to.phi - from.phi) * e, z: from.z + (to.z - from.z) * e };
      this.moving = u < 1; this.request();
      if (u < 1) this.spinRaf = requestAnimationFrame(step); else { this.moving = false; this.request(); this.onView(this.view()); }
    };
    this.spinRaf = requestAnimationFrame(step);
  }
  setMode(mode) {
    const center = this.w ? this.centerLonLat() : [0, 20];
    const prev = this.mode;
    this.mode = mode;
    if (mode === 'flat') {
      this.sel.call(this.zoom).on('dblclick.zoom', null);
      if (prev === 'globe') this.centerOn(center[0], center[1], Math.max(1, Math.min(8, this.globe.z * 1.4)), false);
    } else {
      this.sel.on('.zoom', null);
      if (prev === 'flat') this.globe = { lambda: -center[0], phi: Math.max(-60, Math.min(60, -center[1])), z: Math.max(1, Math.min(4, this.t.k / 1.4)) };
    }
    this.request();
    this.onView(this.view());
  }

  /* ---------------- pointer: taps, long-press, globe gestures ---------------- */
  bindPointer() {
    const c = this.canvas;
    const pts = new Map();
    let down = null, lp = 0, pinch0 = null, moved = false;
    const pos = ev => { const r = c.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    c.addEventListener('pointerdown', ev => {
      pts.set(ev.pointerId, pos(ev));
      if (pts.size === 1) {
        down = { p: pos(ev), t: performance.now(), g: { ...this.globe } }; moved = false;
        clearTimeout(lp);
        lp = setTimeout(() => {
          if (!down || moved) return;
          const ll = this.toLonLat(down.p[0], down.p[1]);
          down = null;
          if (ll) { if (navigator.vibrate) navigator.vibrate(12); this.onLongPress({ lon: ll[0], lat: ll[1] }); }
        }, 560);
      } else { clearTimeout(lp); moved = true; }
      if (this.mode === 'globe') {
        c.setPointerCapture(ev.pointerId);
        if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: this.globe.z }; }
      }
    });
    c.addEventListener('pointermove', ev => {
      if (!pts.has(ev.pointerId)) return;
      const p = pos(ev);
      pts.set(ev.pointerId, p);
      if (down && Math.hypot(p[0] - down.p[0], p[1] - down.p[1]) > 8) { moved = true; clearTimeout(lp); }
      if (this.mode !== 'globe') return;
      if (pts.size === 2 && pinch0) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.globe.z = Math.max(0.8, Math.min(8, pinch0.z * d / pinch0.d));
        this.moving = true; this.request();
      } else if (pts.size === 1 && down && moved) {
        const r = Math.min(this.w, this.h) / 2 * 0.9 * this.globe.z;
        const f = 90 / r;
        this.globe.lambda = down.g.lambda + (p[0] - down.p[0]) * f;
        this.globe.phi = Math.max(-80, Math.min(80, down.g.phi - (p[1] - down.p[1]) * f));
        this.moving = true; this.request();
      }
    });
    const end = ev => {
      if (!pts.has(ev.pointerId)) return;
      pts.delete(ev.pointerId);
      clearTimeout(lp);
      if (pts.size < 2) pinch0 = null;
      if (down && !moved && ev.type === 'pointerup' && performance.now() - down.t < 500) this.tap(down.p[0], down.p[1]);
      if (!pts.size) { down = null; if (this.moving) { this.moving = false; this.request(); this.onView(this.view()); } }
      else if (this.mode === 'globe') { const p = [...pts.values()][0]; down = { p, t: performance.now(), g: { ...this.globe } }; moved = true; }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', ev => {
      if (this.mode !== 'globe') return;
      ev.preventDefault();
      this.globe.z = Math.max(0.8, Math.min(8, this.globe.z * Math.pow(2, -ev.deltaY / 400)));
      this.request(); this.onView(this.view());
    }, { passive: false });
    c.addEventListener('contextmenu', ev => ev.preventDefault());
  }
  /** what is under a screen point: a marker/pin first, then a country */
  hit(x, y) {
    // markers and pins win only when the tap is really on them, so they do not steal taps from countries
    let best = null, bd = 9;
    for (const m of this.screenMarkers || []) {
      const d = Math.hypot(m.x - x, m.y - y) - (m.r || 4);
      if (d < bd) { bd = d; best = m; }
    }
    if (best) return best.pin ? { pin: best.pin } : { cc: best.cc };
    const ll = this.toLonLat(x, y);
    if (!ll) return null;
    const country = this.countryAt(ll[0], ll[1]);
    return { cc: country, lon: ll[0], lat: ll[1] };
  }
  countryAt(lon, lat) {
    for (const f of this.features) {
      if (!f.id) continue;
      const b = f.bbox2;
      const inLat = lat >= b[0][1] - 0.01 && lat <= b[1][1] + 0.01;
      const inLon = b[0][0] <= b[1][0] ? lon >= b[0][0] - 0.01 && lon <= b[1][0] + 0.01 : lon >= b[0][0] || lon <= b[1][0];
      if (inLat && inLon && geoContains(f, [lon, lat])) return f.id;
    }
    return null;
  }
  tap(x, y) {
    const h = this.hit(x, y);
    this.onTap(h || {}, { x, y });
  }

  /* ---------------- the "stamp" when a country is marked ---------------- */
  stamp(cc, from, x, y) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.anim = { cc, from, x, y, t0: performance.now(), dur: 650 };
    this.request();
  }

  /* ---------------- drawing ---------------- */
  request() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }
  colors() { return this.style.colors; }
  draw() {
    const ctx = this.ctx, dpr = this.dpr, { w, h } = this;
    if (!w) return;
    const col = this.colors();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.screenMarkers = [];
    if (this.mode === 'globe') this.drawGlobe(ctx, col); else this.drawFlat(ctx, col);
    if (this.anim && performance.now() - this.anim.t0 < this.anim.dur) this.request(); else this.anim = null;
  }
  fillFor(cc) { return this.style.fill(cc); }
  drawFlat(ctx, col) {
    const { w, h, dpr } = this;
    const s = this.t.k * this.fit;
    ctx.fillStyle = col.sea; ctx.fillRect(0, 0, w, h);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * this.t.x, dpr * this.t.y);
    // only what is on screen
    const vx0 = -this.t.x / s, vy0 = -this.t.y / s, vx1 = vx0 + w / s, vy1 = vy0 + h / s;
    const anim = this.anim;
    for (const f of this.features) {
      if (!f.p2d) continue;
      const b = f.wb;
      if (b[1][0] < vx0 || b[0][0] > vx1 || b[1][1] < vy0 || b[0][1] > vy1) continue;
      ctx.fillStyle = f.id ? this.fillFor(f.id) : col.land;
      if (anim && anim.cc === f.id) ctx.fillStyle = anim.from;
      ctx.fill(f.p2d);
    }
    if (anim) this.drawStamp(ctx, anim, () => { const f = this.features.find(x => x.id === anim.cc); if (f && f.p2d) ctx.fill(f.p2d); }, s);
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.35, 0.8 * Math.min(1.6, Math.sqrt(this.t.k) * 0.6)) / s;
    ctx.strokeStyle = col.border;
    ctx.stroke(this.allPath);
    if (this.style.highlight) {
      const f = this.features.find(x => x.id === this.style.highlight);
      if (f && f.p2d) { ctx.lineWidth = 2.2 / s; ctx.strokeStyle = col.highlight; ctx.stroke(f.p2d); }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawOverlays(ctx, col, (lon, lat) => this.toScreen(lon, lat), s);
  }
  drawStamp(ctx, anim, fillShape, s) {
    const u = Math.min(1, (performance.now() - anim.t0) / anim.dur);
    ctx.save();
    // ink spreads from where the user tapped
    const cur = ctx.getTransform();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.beginPath();
    ctx.arc(anim.x, anim.y, ease(u) * Math.max(this.w, this.h) * 0.9, 0, Math.PI * 2);
    ctx.setTransform(cur);
    ctx.clip();
    ctx.fillStyle = this.fillFor(anim.cc);
    fillShape();
    ctx.restore();
  }
  drawGlobe(ctx, col) {
    const { w, h } = this;
    const lo = this.moving && this.featuresLo !== this.features;
    const proj = this.globeProj();
    const path = geoPath(proj, ctx);
    const r = proj.scale();
    // the sea, with a soft rim
    ctx.beginPath(); path({ type: 'Sphere' });
    ctx.fillStyle = col.globeSea || col.sea; ctx.fill();
    const g = ctx.createRadialGradient(w / 2 - r * 0.3, h / 2 - r * 0.35, r * 0.1, w / 2, h / 2, r);
    g.addColorStop(0, col.glow || 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); path(geoGraticule10());
    ctx.lineWidth = 0.5; ctx.strokeStyle = col.graticule; ctx.stroke();
    const feats = lo ? this.featuresLo : this.features;
    const anim = this.anim;
    for (const f of feats) {
      if (!f.id && !f.geometry) continue;
      ctx.beginPath(); path(f);
      ctx.fillStyle = f.id ? (anim && anim.cc === f.id ? anim.from : this.fillFor(f.id)) : col.land;
      ctx.fill();
    }
    if (anim) this.drawStamp(ctx, anim, () => { const f = feats.find(x => x.id === anim.cc); if (f) { ctx.beginPath(); path(f); ctx.fill(); } }, 1);
    ctx.lineWidth = 0.6; ctx.strokeStyle = col.border;
    ctx.beginPath();
    for (const f of feats) path(f);
    ctx.stroke();
    if (this.style.highlight) {
      const f = feats.find(x => x.id === this.style.highlight);
      if (f) { ctx.beginPath(); path(f); ctx.lineWidth = 2.2; ctx.strokeStyle = col.highlight; ctx.stroke(); }
    }
    ctx.beginPath(); path({ type: 'Sphere' });
    ctx.lineWidth = 1; ctx.strokeStyle = col.rim || col.border; ctx.stroke();
    const center = [-this.globe.lambda, -this.globe.phi];
    this.drawOverlays(ctx, col, (lon, lat) => (geoDistance([lon, lat], center) < Math.PI / 2 - 0.02 ? proj([lon, lat]) : null), this.globe.z * 3);
  }
  drawOverlays(ctx, col, at, zoomish) {
    const { w, h } = this;
    const onScreen = p => p && p[0] > -20 && p[0] < w + 20 && p[1] > -20 && p[1] < h + 20;
    const labels = [];
    const free = (x, y, tw, th) => {
      const r = [x - tw / 2 - 3, y - th / 2 - 2, x + tw / 2 + 3, y + th / 2 + 2];
      for (const q of labels) if (r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) return false;
      labels.push(r); return true;
    };
    // country names when there is room
    if (this.style.labels && this.style.labelFor && (this.mode === 'flat' ? this.t.k >= 2.2 : this.globe.z >= 1.6)) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `500 ${this.mode === 'flat' ? 11 : 10.5}px "Plex Arabic", system-ui, sans-serif`;
      const s = this.mode === 'flat' ? this.t.k * this.fit : 0;
      const list = this.features.filter(f => f.id && f.p2d).sort((a, b) => b.area - a.area);
      for (const f of list) {
        if (this.mode === 'flat') { const bw = (f.wb[1][0] - f.wb[0][0]) * s; if (bw < 46 || bw > w * 3) continue; }
        else if (f.area < 0.002 / this.globe.z) continue;
        const lp = this.style.labelPoint(f.id);
        if (!lp) continue;
        const p = at(lp[1], lp[0]);
        if (!onScreen(p)) continue;
        const text = this.style.labelFor(f.id);
        const tw = ctx.measureText(text).width;
        if (!free(p[0], p[1], tw, 12)) continue;
        ctx.lineWidth = 3; ctx.strokeStyle = col.labelHalo; ctx.strokeText(text, p[0], p[1]);
        ctx.fillStyle = col.label; ctx.fillText(text, p[0], p[1]);
        if (labels.length > 70) break;
      }
    }
    // small countries as dots, so they can be seen and tapped
    for (const m of this.style.markers) {
      const p = at(m.lon, m.lat);
      if (!onScreen(p)) continue;
      // not-yet-visited small countries stay faint until you zoom in
      const zoomed = this.mode === 'flat' ? this.t.k >= 3 : this.globe.z >= 2.2;
      const r = m.faint && zoomed ? (m.r || 4) + 0.8 : m.r || 4;
      ctx.globalAlpha = m.faint && !zoomed ? 0.55 : 1;
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fillStyle = m.color; ctx.fill();
      ctx.lineWidth = m.faint ? 0.8 : 1.2; ctx.strokeStyle = col.markerRing; ctx.stroke();
      ctx.globalAlpha = 1;
      this.screenMarkers.push({ x: p[0], y: p[1], r: Math.max(r, 4), cc: m.cc });
    }
    // city pins
    const showNames = this.mode === 'flat' ? this.t.k >= 5 : this.globe.z >= 3;
    ctx.textBaseline = 'middle';
    for (const pin of this.style.pins) {
      const p = at(pin.lon, pin.lat);
      if (!onScreen(p)) continue;
      const r = pin.kind === 'home' ? 5.5 : 3.6;
      ctx.beginPath();
      if (pin.kind === 'home') {
        // a diamond for home
        ctx.moveTo(p[0], p[1] - r); ctx.lineTo(p[0] + r, p[1]); ctx.lineTo(p[0], p[1] + r); ctx.lineTo(p[0] - r, p[1]); ctx.closePath();
        ctx.fillStyle = col.home; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = col.pinRing; ctx.stroke();
      } else {
        ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
        if (pin.kind === 'wish') { ctx.fillStyle = col.pinRing; ctx.fill(); ctx.lineWidth = 1.8; ctx.strokeStyle = col.wish; ctx.stroke(); }
        else { ctx.fillStyle = pin.kind === 'lived' ? col.lived : col.pin; ctx.fill(); ctx.lineWidth = 1.4; ctx.strokeStyle = col.pinRing; ctx.stroke(); }
      }
      this.screenMarkers.push({ x: p[0], y: p[1], r: r + 2, pin: pin.id });
      if (showNames && pin.label) {
        ctx.font = '500 11px "Plex Arabic", system-ui, sans-serif';
        ctx.textAlign = document.dir === 'rtl' ? 'right' : 'left';
        const dx = document.dir === 'rtl' ? -(r + 4) : r + 4;
        const tw = ctx.measureText(pin.label).width;
        const cx = p[0] + dx + (document.dir === 'rtl' ? -tw / 2 : tw / 2);
        if (!free(cx, p[1], tw, 12)) continue;
        ctx.lineWidth = 3; ctx.strokeStyle = col.labelHalo; ctx.strokeText(pin.label, p[0] + dx, p[1]);
        ctx.fillStyle = col.pinLabel; ctx.fillText(pin.label, p[0] + dx, p[1]);
      }
    }
  }

  /** draws the whole map (or a region) into another canvas — for share cards and the report */
  renderTo(canvas, { width, height, fitPoints, padding = 0.04, colors, globe = false } = {}) {
    const saved = { canvas: this.canvas, ctx: this.ctx, w: this.w, h: this.h, dpr: this.dpr, fit: this.fit, t: this.t, mode: this.mode, globe: this.globe, anim: this.anim, colorsOverride: this.style.colors, highlight: this.style.highlight };
    try {
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.w = width; this.h = height; this.dpr = canvas.width / width;
      this.anim = null;
      if (colors) this.style.colors = colors;
      this.style.highlight = null;
      if (globe) {
        this.mode = 'globe';
        const c = fitPoints && fitPoints.length ? fitPoints.reduce((a, p) => [a[0] + p[0] / fitPoints.length, a[1] + p[1] / fitPoints.length], [0, 0]) : [45, 25];
        this.globe = { lambda: -c[0], phi: Math.max(-50, Math.min(50, -c[1])), z: 1 };
      } else {
        this.mode = 'flat';
        this.fit = Math.min(width / W, height / H) * (1 - padding * 2);
        const k = 1, s = this.fit;
        this.t = zoomIdentity.translate((width - W * s) / 2, (height - H * s) / 2).scale(k);
        if (fitPoints && fitPoints.length > 1) {
          const ps = fitPoints.map(p => this.proj(p));
          const xs = ps.map(p => p[0]), ys = ps.map(p => p[1]);
          let bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
          bw = Math.max(bw * 1.25, 120); bh = Math.max(bh * 1.25, 80);
          const kk = Math.max(1, Math.min(6, Math.min(width / (bw * s), height / (bh * s))));
          const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
          this.t = zoomIdentity.translate(width / 2 - cx * s * kk, height / 2 - cy * s * kk).scale(kk);
        }
      }
      this.draw();
    } finally {
      Object.assign(this, { canvas: saved.canvas, ctx: saved.ctx, w: saved.w, h: saved.h, dpr: saved.dpr, fit: saved.fit, t: saved.t, mode: saved.mode, globe: saved.globe, anim: saved.anim });
      this.style.colors = saved.colorsOverride; this.style.highlight = saved.highlight;
      this.request();
    }
  }

  destroy() {
    this.ro.disconnect();
    cancelAnimationFrame(this.raf); cancelAnimationFrame(this.goRaf); cancelAnimationFrame(this.spinRaf);
    this.sel.on('.zoom', null);
  }
}

/** the flat map's projection, for drawing the same map in the PDF report */
export function flatProjection() { return geoProjection(millerRaw).scale(S0).translate([W / 2, H / 2]).precision(0.2); }
export const FLAT_SIZE = { W, H };

/** a small static map of a route (trip page, share cards): countries shaded, the path drawn as great circles */
export function drawRouteMap(canvas, { features, points, colors, fill, width, height, pad = 28, maxScale = 2200 }) {
  const ctx = canvas.getContext('2d');
  const dpr = canvas.width / width;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = colors.sea; ctx.fillRect(0, 0, width, height);
  if (!points.length) return;
  const proj = geoProjection(millerRaw).precision(0.3);
  const line = { type: 'LineString', coordinates: points.map(p => [p.lon, p.lat]) };
  const centreOn = ll => { const p = proj(ll); const tr = proj.translate(); proj.translate([tr[0] + width / 2 - p[0], tr[1] + height / 2 - p[1]]); };
  if (points.length > 1) proj.fitExtent([[pad, pad], [width - pad, height - pad]], line);
  else { proj.scale(maxScale / 2); centreOn([points[0].lon, points[0].lat]); }
  // a short route still shows its region
  if (proj.scale() > maxScale) { const c = proj.invert([width / 2, height / 2]); proj.scale(maxScale); centreOn(c); }
  const path = geoPath(proj, ctx);
  for (const f of features) {
    ctx.beginPath(); path(f);
    ctx.fillStyle = (f.id && fill(f.id)) || colors.land; ctx.fill();
  }
  ctx.lineWidth = 0.6; ctx.strokeStyle = colors.border;
  ctx.beginPath(); for (const f of features) path(f); ctx.stroke();
  if (points.length > 1) {
    ctx.beginPath(); path(line);
    ctx.lineWidth = 2.4; ctx.strokeStyle = colors.route || colors.pin; ctx.setLineDash([6, 5]); ctx.lineCap = 'round'; ctx.stroke(); ctx.setLineDash([]);
  }
  points.forEach(p => {
    const q = proj([p.lon, p.lat]); if (!q) return;
    ctx.beginPath(); ctx.arc(q[0], q[1], p.home ? 5.5 : 4.5, 0, Math.PI * 2);
    ctx.fillStyle = p.home ? colors.home : colors.pin; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = colors.pinRing; ctx.stroke();
  });
}

/** a small globe (passport "photo", share cards) */
export function drawGlobe(canvas, { features, fill, colors, center = [45, 25], width, height, scale = 0.46, tilt = 0 }) {
  const ctx = canvas.getContext('2d');
  const dpr = canvas.width / width;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const r = Math.min(width, height) * scale;
  const proj = geoOrthographic().rotate([-center[0], -center[1] + tilt]).scale(r).translate([width / 2, height / 2]).clipAngle(90).precision(0.6);
  const path = geoPath(proj, ctx);
  ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = colors.globeSea || colors.sea; ctx.fill();
  ctx.beginPath(); path(geoGraticule10()); ctx.lineWidth = 0.5; ctx.strokeStyle = colors.graticule; ctx.stroke();
  for (const f of features) { ctx.beginPath(); path(f); ctx.fillStyle = (f.id && fill(f.id)) || colors.land; ctx.fill(); }
  ctx.beginPath(); for (const f of features) path(f); ctx.lineWidth = 0.4; ctx.strokeStyle = colors.border; ctx.stroke();
  ctx.beginPath(); path({ type: 'Sphere' }); ctx.lineWidth = 1; ctx.strokeStyle = colors.rim || colors.border; ctx.stroke();
}
/** the whole flat world (cards, report) */
export function drawFlatWorld(canvas, { features, fill, colors, width, height, pad = 0, markers = [], pins = [] }) {
  const ctx = canvas.getContext('2d');
  const dpr = canvas.width / width;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const proj = geoProjection(millerRaw).precision(0.3);
  // the world from 60°S (no Antarctica) to 84°N
  const box = { type: 'MultiPoint', coordinates: [[-180, -58], [180, 84]] };
  proj.fitExtent([[pad, pad], [width - pad, height - pad]], box);
  const path = geoPath(proj, ctx);
  for (const f of features) { if (f.id === 'AQ') continue; ctx.beginPath(); path(f); ctx.fillStyle = (f.id && fill(f.id)) || colors.land; ctx.fill(); }
  ctx.beginPath(); for (const f of features) if (f.id !== 'AQ') path(f); ctx.lineWidth = Math.max(0.3, width / 2400); ctx.strokeStyle = colors.border; ctx.stroke();
  for (const m of markers) { const p = proj([m.lon, m.lat]); if (!p) continue; ctx.beginPath(); ctx.arc(p[0], p[1], m.r, 0, Math.PI * 2); ctx.fillStyle = m.color; ctx.fill(); }
  for (const m of pins) { const p = proj([m.lon, m.lat]); if (!p) continue; ctx.beginPath(); ctx.arc(p[0], p[1], m.r, 0, Math.PI * 2); ctx.fillStyle = m.color; ctx.fill(); ctx.lineWidth = m.r * 0.5; ctx.strokeStyle = m.ring; ctx.stroke(); }
  return proj;
}
