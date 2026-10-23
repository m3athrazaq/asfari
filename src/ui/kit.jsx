// Shared building blocks: flags, top bar, sheets, dialogs, toasts, fields.
import { signal } from '@preact/signals';
import { useEffect, useRef, useState, useMemo } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { t, num, isAr, fmtDate, cname } from '../core/i18n.js';
import { byName } from '../core/i18n.js';
import { back as goBack, pushOverlay } from './router.js';
import { COUNTRIES, C, searchCountries, CONTINENTS } from '../core/data.js';
import { parseDate, todayISO } from '../core/util.js';

export function Flag({ cc, size, alt }) {
  if (!cc) return null;
  return <img class={'flag' + (size ? ' ' + size : '')} src={`flags/${cc.toLowerCase()}.svg`} alt={alt || ''} loading="lazy" decoding="async" />;
}

export function TopBar({ title, back, actions, sub, onBack }) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    const f = () => el && el.classList.toggle('scrolled', window.scrollY > 4);
    addEventListener('scroll', f, { passive: true }); f();
    return () => removeEventListener('scroll', f);
  }, []);
  return (
    <header class="topbar" ref={ref}>
      <div class="wrap">
        {back && <button class="iconbtn" onClick={() => (onBack ? onBack() : goBack(typeof back === 'string' ? back : 'map'))} aria-label={t('back')}><Icon name="back" class="flip" /></button>}
        <h1 class={sub ? 'sub' : ''}>{title}</h1>
        {actions}
      </div>
    </header>
  );
}

/* ---------- toasts & dialogs (rendered once by the app shell) ---------- */
export const toasts = signal([]);
let toastId = 0;
export function toast(text, { action, onAction, ms = 3800 } = {}) {
  const id = ++toastId;
  toasts.value = [...toasts.value.slice(-2), { id, text, action, onAction }];
  setTimeout(() => { toasts.value = toasts.value.filter(x => x.id !== id); }, ms);
}
export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map(x => (
        <div class="toast" key={x.id}>
          <span>{x.text}</span>
          {x.action && <button onClick={() => { toasts.value = toasts.value.filter(y => y.id !== x.id); x.onAction && x.onAction(); }}>{x.action}</button>}
        </div>
      ))}
    </div>
  );
}
export const dialog = signal(null);
/** a yes/no question → Promise<boolean> */
export function confirmDialog({ title, text, ok, danger = false, cancel }) {
  return new Promise(resolve => { dialog.value = { title, text, ok: ok || t('ok'), cancel: cancel || t('cancel'), danger, resolve }; });
}
export function DialogHost() {
  const d = dialog.value;
  const okRef = useRef();
  useEffect(() => {
    if (!d) return;
    const close = () => { dialog.value = null; d.resolve(false); };
    const pop = pushOverlay(close);
    setTimeout(() => okRef.current && okRef.current.focus(), 30);
    return pop;
  }, [d]);
  if (!d) return null;
  const done = v => { dialog.value = null; d.resolve(v); };
  return (
    <>
      <div class="scrim" onClick={() => done(false)} />
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" onClick={e => { if (e.target === e.currentTarget) done(false); }}>
        <div class="box">
          <h3 id="dlg-t">{d.title}</h3>
          {d.text && <p>{d.text}</p>}
          <div class="btns">
            <button class="btn ghost" onClick={() => done(false)}>{d.cancel}</button>
            <button class={'btn' + (d.danger ? ' danger' : '')} ref={okRef} onClick={() => done(true)}>{d.ok}</button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- bottom sheet ---------- */
export function Sheet({ onClose, title, head, children, label }) {
  const ref = useRef();
  useEffect(() => {
    const pop = pushOverlay(onClose);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const key = e => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', key);
    return () => { pop(); document.body.style.overflow = prev; removeEventListener('keydown', key); };
  }, []);
  // drag the handle down to close
  const drag = useRef(null);
  const onDown = e => { drag.current = { y: e.clientY, t: performance.now() }; e.currentTarget.setPointerCapture(e.pointerId); };
  const onMove = e => {
    if (!drag.current || !ref.current) return;
    const dy = Math.max(0, e.clientY - drag.current.y);
    ref.current.style.transform = `translateY(${dy}px)`;
  };
  const onUp = e => {
    if (!drag.current || !ref.current) return;
    const dy = e.clientY - drag.current.y, v = dy / Math.max(1, performance.now() - drag.current.t);
    drag.current = null;
    if (dy > 110 || v > 0.6) onClose(); else ref.current.style.transform = '';
  };
  return (
    <>
      <div class="scrim" onClick={onClose} />
      <section class="sheet" ref={ref} role="dialog" aria-modal="true" aria-label={label || title}>
        <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style="touch-action:none;padding-bottom:4px">
          <div class="grab" />
          {(title || head) && (
            <div class="sheet-h">
              {head || <h3>{title}</h3>}
              <button class="iconbtn" onClick={onClose} aria-label={t('close')}><Icon name="x" /></button>
            </div>
          )}
        </div>
        <div class="sheet-b">{children}</div>
      </section>
    </>
  );
}

/* ---------- inputs ---------- */
export function Seg({ value, options, onChange, label, mini }) {
  return (
    <div class={'seg' + (mini ? ' mini' : '')} role="group" aria-label={label}>
      {options.map(([v, l]) => <button type="button" key={v} aria-pressed={value === v ? 'true' : 'false'} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}
export function Toggle({ checked, onChange, label, sub }) {
  return (
    <button type="button" class="toggle" role="switch" aria-checked={checked ? 'true' : 'false'} onClick={() => onChange(!checked)}>
      <span class="grow"><span style="display:block;font-weight:500">{label}</span>{sub && <span class="small muted">{sub}</span>}</span>
      <span class="switch" />
    </button>
  );
}
export function Stars({ value = 0, onChange, readOnly, label }) {
  if (readOnly) {
    if (!value) return null;
    return <span class="stars ro" aria-label={t('rating_of', { n: num(value) })}>{Array.from({ length: value }, (_, i) => <Icon key={i} name="star" fill="currentColor" stroke="none" />)}</span>;
  }
  return (
    <span class="stars" role="radiogroup" aria-label={label || t('rating')}>
      {[1, 2, 3, 4, 5].map(n => (
        <button type="button" key={n} class={n <= value ? 'on' : ''} role="radio" aria-checked={n === value ? 'true' : 'false'} aria-label={num(n)} onClick={() => onChange(n === value ? 0 : n)}>
          <Icon name="star" fill={n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </span>
  );
}
export function Field({ label, children, hint }) {
  return <label class="field"><span class="lab">{label}</span>{children}{hint && <p class="hint">{hint}</p>}</label>;
}

/** a date the user knows to the day, the month or only the year */
export function DateField({ label, value, onChange, hint, allowClear = true }) {
  const p = parseDate(value);
  const [prec, setPrec] = useState(p ? p.prec : 'day');
  const thisYear = +todayISO().slice(0, 4);
  const years = useMemo(() => { const a = []; for (let y = thisYear + 5; y >= 1940; y--) a.push(y); return a; }, [thisYear]);
  const change = (np, v) => {
    // keep what can be kept when the precision changes
    const q = parseDate(v ?? value);
    if (!q) return onChange('');
    if (np === 'year') return onChange(String(q.y));
    if (np === 'month') return onChange(`${q.y}-${String(q.m || 1).padStart(2, '0')}`);
    return onChange(`${q.y}-${String(q.m || 1).padStart(2, '0')}-${String(q.d || 1).padStart(2, '0')}`);
  };
  return (
    <div class="field" style="margin-top:14px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span class="lab" style="margin:0;flex:1">{label}</span>
        <Seg mini value={prec} label={label} onChange={np => { setPrec(np); if (value) change(np); }}
          options={[['day', t('prec_day')], ['month', t('prec_month')], ['year', t('prec_year')]]} />
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        {prec === 'day' && <input class="input" type="date" value={p && p.prec === 'day' ? value : ''} onInput={e => onChange(e.currentTarget.value)} aria-label={label} />}
        {prec === 'month' && <input class="input" type="month" value={p && p.m ? value.slice(0, 7) : ''} onInput={e => onChange(e.currentTarget.value)} aria-label={label} />}
        {prec === 'year' && (
          <select class="input" value={p ? String(p.y) : ''} onChange={e => onChange(e.currentTarget.value)} aria-label={label}>
            <option value="">—</option>
            {years.map(y => <option key={y} value={y}>{num(y).replace(/[,٬]/g, '')}</option>)}
          </select>
        )}
        {allowClear && value && <button type="button" class="iconbtn" onClick={() => onChange('')} aria-label={t('clear')}><Icon name="x" /></button>}
      </div>
      {hint && <p class="hint">{hint}</p>}
    </div>
  );
}

/** an exact day (or nothing) — for the dates of a trip's stops */
export function DayInput({ label, value, onChange }) {
  return (
    <label class="field">
      <span class="lab">{label}</span>
      <input class="input" type="date" value={value && value.length === 10 ? value : ''} onInput={e => onChange(e.currentTarget.value)} />
    </label>
  );
}

export function Bar({ value, max, color }) {
  const w = max ? Math.min(100, (value / max) * 100) : 0;
  return <div class="bar" role="presentation"><i style={{ width: w + '%', background: color }} /></div>;
}
export function Empty({ icon = 'globe', title, text, children }) {
  return (
    <div class="empty">
      <Icon name={icon} class="big" />
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}

/** pick one country (sheet with search) */
export function CountryPicker({ onPick, onClose, title, exclude = [] }) {
  const [q, setQ] = useState('');
  const inp = useRef();
  useEffect(() => { setTimeout(() => inp.current && inp.current.focus(), 150); }, []);
  const list = useMemo(() => {
    const ex = new Set(exclude);
    const base = q.trim() ? searchCountries(q.trim(), isAr.value ? 'ar' : 'en') : [...COUNTRIES].sort((a, b) => byName(isAr.value ? a.ar : a.en, isAr.value ? b.ar : b.en));
    return base.filter(c => !ex.has(c.c)).slice(0, 260);
  }, [q]);
  return (
    <Sheet onClose={onClose} title={title || t('pick_country')}>
      <div class="search"><Icon name="search" /><input ref={inp} value={q} onInput={e => setQ(e.currentTarget.value)} placeholder={t('search_countries')} aria-label={t('search_countries')} /></div>
      <div class="list pick-list" style="margin-top:10px">
        {list.map(c => (
          <button class="row" key={c.c} onClick={() => onPick(c.c)}>
            <Flag cc={c.c} />
            <span class="grow"><span class="title">{cname(c)}</span><span class="meta">{isAr.value ? c.en : c.ar}</span></span>
          </button>
        ))}
        {!list.length && <p class="hint" style="padding:16px">{t('no_results')}</p>}
      </div>
    </Sheet>
  );
}

export const Spinner = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style="animation:spin 0.9s linear infinite">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="40 20" stroke-linecap="round" />
  </svg>
);
export { C, CONTINENTS };
