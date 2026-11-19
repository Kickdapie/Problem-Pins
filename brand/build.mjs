// Single source for the Problem Pins mark and the Pip mascot.
// Run `node brand/build.mjs` to regenerate every SVG in this folder plus preview.html.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));

// Same tokens as src/index.css and src/data/meta.ts
const BRAND = '#ef5a1f';
const INK = '#141b2d';
const STATUS = {
  in_review: '#c98a1b',
  scheduled: '#2f6db5',
  sent_to_city: '#8e63c7',
  fixed: '#2e8b57',
};

// ---- Motion. Plain CSS inside each SVG, so it plays anywhere the file is used as an <img>.
// One loop per pose, small amplitudes, and everything stops under prefers-reduced-motion.
const MOTION = `
.pip-pivot,.pip-eyes,.pip-shadow,.pip-badge,.pip-glyph{transform-box:fill-box;transform-origin:50% 50%}
.pip-pivot{transform-origin:50% 100%}
.pip-blink{animation:pip-blink 5.2s infinite}
.pip-sway{animation:pip-sway 3.6s ease-in-out infinite alternate}
.pip-sigh{animation:pip-sigh 4.4s ease-in-out infinite alternate}
.pip-hop{animation:pip-hop 2.8s cubic-bezier(.3,0,.3,1) infinite}
.pip-hop-shadow{animation:pip-hop-shadow 2.8s cubic-bezier(.3,0,.3,1) infinite}
.pip-pop{animation:pip-pop .5s cubic-bezier(.3,1.5,.5,1) .25s both}
.pip-seek{animation:pip-seek 3.2s ease-in-out infinite}
.pip-flip{animation:pip-flip 5s ease-in-out infinite}
.pip-drop{animation:pip-drop .5s cubic-bezier(.3,0,.3,1) both}
@keyframes pip-blink{0%,94%,100%{transform:scaleY(1)}97%{transform:scaleY(.1)}}
@keyframes pip-sway{from{transform:rotate(-2.5deg)}to{transform:rotate(2.5deg)}}
@keyframes pip-sigh{from{transform:scale(1)}to{transform:scale(1.03,.96)}}
@keyframes pip-hop{0%,50%,100%{transform:translateY(var(--lift))}10%{transform:translateY(var(--lift)) scale(1.06,.92)}28%{transform:translateY(0) scale(.97,1.03)}42%{transform:translateY(var(--lift)) scale(1.05,.94)}}
@keyframes pip-hop-shadow{0%,10%,42%,100%{transform:scaleX(1.45)}28%{transform:scaleX(1)}}
@keyframes pip-pop{from{transform:scale(0)}to{transform:scale(1)}}
@keyframes pip-seek{0%,100%{transform:translate(0,0)}25%{transform:translate(-3px,2px)}50%{transform:translate(0,4px)}75%{transform:translate(3px,2px)}}
@keyframes pip-flip{0%,80%{transform:rotate(0)}100%{transform:rotate(180deg)}}
@keyframes pip-drop{0%{transform:translateY(-70px);opacity:0}55%{transform:translateY(0);opacity:1}72%{transform:scale(1.08,.9)}100%{transform:none}}
@media (prefers-reduced-motion:reduce){[class*="pip-"]{animation:none!important}}
`.trim().replace(/\n/g, '');
let embedMotion = true; // files carry their own <style>; the preview page inlines it once

// ---- Pip geometry. Local origin = centre of the head, tip of the pin at (0, 66). ----
const BODY = 'M0 66C-10 52-40 27-40 0a40 40 0 1 1 80 0C40 27 10 52 0 66Z';

const body = (fill) =>
  `<path d="${BODY}" fill="${fill}" stroke="${fill}" stroke-width="8" stroke-linejoin="round"/>`;

// Eye kinds: open, wide, squint, happy (closed arc), weary (half-lidded, outer corner drooping).
// `kind` is one name for both eyes or [left, right]. `delay` offsets the blink so poses do not blink in unison.
function eyes(kind, { dx = 0, dy = 0, color = INK, rx = 6.5, ry = 9, gap = 14, delay = 0 } = {}) {
  const y = 8 + dy;
  const kinds = Array.isArray(kind) ? kind : [kind, kind];
  return [-1, 1]
    .map((side, i) => {
      const x = side * gap + dx;
      const k = kinds[i];
      if (k === 'happy')
        return `<path d="M${x - 7.5} ${y + 3.5}q7.5-11.5 15 0" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`;
      let shape;
      if (k === 'weary')
        shape =
          `<g transform="rotate(${side * 9} ${x} ${y})">` +
          `<path d="M${x - rx} ${y}a${rx} ${ry - 2} 0 0 0 ${rx * 2} 0Z" fill="${color}"/>` +
          `<path d="M${x - rx - 1} ${y}h${rx * 2 + 2}" stroke="${color}" stroke-width="3.2" stroke-linecap="round"/></g>`;
      else {
        const h = k === 'wide' ? ry * 1.14 : k === 'squint' ? ry * 0.8 : ry;
        shape = `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${Math.round(h * 100) / 100}" fill="${color}"/>`;
      }
      return `<g class="pip-eyes pip-blink"${delay ? ` style="animation-delay:-${delay}s"` : ''}>${shape}</g>`;
    })
    .join('');
}

// Badge glyphs, drawn on a 24px grid like the lucide icons used in the app.
const GLYPH = {
  plus1: 'M4.5 12h8M8.5 8v8M16 9.3l3-2.3v10',
  search: 'M18 11a7 7 0 1 1-14 0a7 7 0 0 1 14 0ZM20.5 20.5l-4.5-4.5',
  calendar: 'M8 2.5v4M16 2.5v4M3.5 10.5h17M6 4.5h12a2.5 2.5 0 0 1 2.5 2.5v11a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V7A2.5 2.5 0 0 1 6 4.5Z',
  hourglass: 'M6 3h12M6 21h12M7.5 3v3.5L12 12l4.5-5.5V3M7.5 21v-3.5L12 12l4.5 5.5V21',
  check: 'M5.5 12.5l4.5 4.5L18.5 7.5',
};

function badge({ glyph, color, loop = '', glyphLoop = '' }, cx = 118, cy = 32, r = 19) {
  const s = 0.85;
  return (
    `<g class="pip-badge pip-pop"><g class="pip-badge ${loop}">` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="#fff" stroke-width="4"/>` +
    `<g class="pip-glyph ${glyphLoop}"><path transform="translate(${cx - 12 * s} ${cy - 12 * s}) scale(${s})" d="${GLYPH[glyph]}" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g>` +
    `</g></g>`
  );
}

function svg(viewBox, inner, size, { animated = false, attrs = '' } = {}) {
  const [, , w, h] = viewBox.split(' ').map(Number);
  const width = size ?? w;
  const height = size ? Math.round((size * h) / w * 100) / 100 : h;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" fill="none"${attrs}>${animated && embedMotion ? `<style>${MOTION}</style>` : ''}${inner}</svg>`;
}

// ---- Poses (160 x 160). Pip pivots on the tip; status colour only ever appears in the badge. ----
const POSES = {
  hello: { label: 'Hello · Open', eyes: 'open', tilt: 5, move: 'pip-sway' },
  plus1: { label: '+1’d', eyes: 'wide', dx: 3, dy: -6, tilt: -5, lift: 8, move: 'pip-hop', badge: { glyph: 'plus1', color: INK } },
  'in-review': { label: 'In review', eyes: 'squint', dx: 6, dy: -4, tilt: 10, move: 'pip-sway', badge: { glyph: 'search', color: STATUS.in_review, loop: 'pip-seek' } },
  scheduled: { label: 'Scheduled', eyes: ['open', 'happy'], dx: 2, dy: -2, tilt: -3, move: 'pip-sway', badge: { glyph: 'calendar', color: STATUS.scheduled } },
  waiting: { label: 'Waiting on City', eyes: 'weary', dy: 3, tilt: -8, sx: 1.05, sy: 0.94, move: 'pip-sigh', badge: { glyph: 'hourglass', color: STATUS.sent_to_city, glyphLoop: 'pip-flip' } },
  fixed: { label: 'Fixed', eyes: 'happy', dy: -2, tilt: 6, lift: 8, move: 'pip-hop', badge: { glyph: 'check', color: STATUS.fixed } },
};

function pose(name, size) {
  const p = POSES[name];
  const cx = p.badge ? 70 : 80;
  const lift = p.lift ?? 0;
  const rx = lift ? 11 : 16;
  const squash = p.sx ? ` translate(0 66) scale(${p.sx} ${p.sy}) translate(0 -66)` : '';
  const delay = Object.keys(POSES).indexOf(name) * 0.9;
  return svg(
    '0 0 160 160',
    `<ellipse class="pip-shadow${lift ? ' pip-hop-shadow' : ''}" cx="${cx}" cy="137" rx="${rx}" ry="${rx * 0.28}" fill="${INK}" opacity=".14"/>` +
      `<g transform="translate(${cx} ${62 - lift}) rotate(${p.tilt ?? 0} 0 66)${squash}"><g class="pip-pivot ${p.move}" style="--lift:${lift}px">${body(BRAND)}${eyes(p.eyes, { dx: p.dx, dy: p.dy, delay })}</g></g>` +
      (p.badge ? badge(p.badge) : ''),
    size,
    { animated: true },
  );
}

// ---- Mark ----
// Primary mark: Pip with no tile. Works on white and on the ink sidebar.
const mark = (size) => svg('-48 -48 96 122', body(BRAND) + eyes('open'), size, { animated: true });

// One-colour mark for stamps, stencils and single-ink print: eyes are knocked out, so it sits on any background.
const markMono = (size, color = INK) =>
  svg(
    '-48 -48 96 122',
    `<mask id="pip-knockout"><rect x="-48" y="-48" width="96" height="122" fill="#fff"/><ellipse cx="-14" cy="8" rx="6.5" ry="9" fill="#000"/><ellipse cx="14" cy="8" rx="6.5" ry="9" fill="#000"/></mask>` +
      `<g mask="url(#pip-knockout)">${body(color)}</g>`,
    size,
  );

// App icon: orange Pip on an ink tile, for places that force a square.
const icon = (size) =>
  svg(
    '0 0 64 64',
    `<rect width="64" height="64" rx="14" fill="${INK}"/>` +
      `<g transform="translate(32 27) scale(.4)">${body(BRAND)}${eyes('open')}</g>`,
    size,
  );

// Favicon: the mark fitted to a square, eyes pushed larger so it holds at 16px.
const favicon = (size) =>
  svg('0 0 64 64', `<g transform="translate(32 25.2) scale(.52)">${body(BRAND)}${eyes('open', { rx: 7.5, ry: 10, gap: 15 })}</g>`, size);

// Map marker for the "drop a pin" picker (same 28 x 36 footprint as the current divIcon).
const marker = (size) =>
  svg(
    '-50 -50 100 126',
    `<g class="pip-pivot pip-drop"><path d="${BODY}" stroke="#fff" stroke-width="18" stroke-linejoin="round"/>${body(BRAND)}${eyes('open')}</g>`,
    size,
    { animated: true, attrs: ' style="overflow:visible"' },
  );

const files = {
  'icon.svg': icon(),
  'favicon.svg': favicon(),
  'mark.svg': mark(),
  'mark-mono.svg': markMono(),
  'map-marker.svg': marker(28),
  ...Object.fromEntries(Object.keys(POSES).map((n) => [`pip-${n}.svg`, pose(n)])),
};
for (const [name, content] of Object.entries(files)) writeFileSync(join(OUT, name), content + '\n');

// ---------------------------------------------------------------- preview.html
embedMotion = false;
const lucidePin = (size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>`;

function qrPlaceholder(size) {
  const n = 21;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const finder = (r, c) => {
    for (const [fr, fc] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      const y = r - fr, x = c - fc;
      if (y >= -1 && y <= 7 && x >= -1 && x <= 7) {
        if (y < 0 || y > 6 || x < 0 || x > 6) return 0;
        return y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4) ? 1 : 0;
      }
    }
    return null;
  };
  let cells = '';
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const f = finder(r, c);
      if (f === 1 || (f === null && rnd() > 0.52)) cells += `<rect x="${c}" y="${r}" width="1.02" height="1.02"/>`;
    }
  return `<svg width="${size}" height="${size}" viewBox="-1.5 -1.5 24 24"><rect x="-1.5" y="-1.5" width="24" height="24" rx="1.6" fill="#fff"/><g fill="${INK}">${cells}</g></svg>`;
}

const USE = {
  hello: 'Scan landing, empty map, noticeboard sticker',
  plus1: 'Right after “+1 This is my problem too”',
  'in-review': 'Status update: the District is looking at it',
  scheduled: 'Status update: a fix has a date',
  waiting: 'Sent to 311, no reply yet. Honest, not cheerful',
  fixed: 'Fix posted and confirmed by residents',
};

const swatches = [
  ['brand', BRAND], ['brand-dark', '#d94b12'], ['brand-soft', '#fff1ea'], ['ink', INK],
  ['in review', STATUS.in_review], ['scheduled', STATUS.scheduled], ['sent to city', STATUS.sent_to_city], ['fixed', STATUS.fixed],
];

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Problem Pins · Mark and Pip</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
  :root { --brand: ${BRAND}; --brand-dark: #d94b12; --brand-soft: #fff1ea; --ink: ${INK}; --line: #e2e8f0; --muted: #64748b; --bg: #f8fafc; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 400 15px/1.55 Inter, ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  svg { display: block; }
  ${MOTION}
  .wrap { max-width: 1040px; margin: 0 auto; padding: 48px 24px 80px; }
  .mono { font: 500 11px/1.4 "JetBrains Mono", ui-monospace, monospace; letter-spacing: .08em; color: var(--muted); text-transform: uppercase; }
  h1 { font-size: 34px; line-height: 1.15; font-weight: 700; letter-spacing: -.02em; margin: 10px 0 10px; }
  h2 { font-size: 20px; font-weight: 600; margin: 4px 0 16px; }
  p { margin: 0; }
  .lede { max-width: 56ch; color: #475569; }
  section { margin-top: 56px; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: 12px; }
  .hero { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .grid { display: grid; gap: 12px; }
  .g3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .g4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .tile { padding: 20px; display: flex; flex-direction: column; gap: 16px; min-height: 172px; }
  .tile .stage { flex: 1; display: flex; align-items: center; justify-content: center; gap: 14px; }
  .tile.dark { background: var(--ink); border-color: var(--ink); }
  .tile.dark .mono, .tile.dark figcaption { color: #7c879b; }
  .lockup { display: inline-flex; align-items: center; gap: 10px; font-weight: 600; font-size: 16px; }
  .lockup.lg { font-size: 22px; gap: 12px; letter-spacing: -.01em; }
  .chip { width: 64px; height: 72px; border-radius: 8px; display: grid; place-items: center; }
  .old { width: 28px; height: 28px; border-radius: 6px; background: var(--brand); display: grid; place-items: center; }
  .arrow { color: #94a3b8; font-size: 18px; }
  .sizes { align-items: flex-end !important; }
  .sizes figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .sizes figcaption { font: 400 10px/1 "JetBrains Mono", monospace; color: #94a3b8; }
  .pose { padding: 12px 20px 18px; }
  .pose .art { display: flex; justify-content: center; }
  .pose h3 { margin: 4px 0 2px; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .pose .dot { width: 8px; height: 8px; border-radius: 50%; }
  .pose p { font-size: 13px; color: var(--muted); }
  .pose .mono { text-transform: none; letter-spacing: 0; font-size: 10.5px; color: #94a3b8; margin-top: 8px; }
  .rules { display: grid; grid-template-columns: 1.1fr 1fr; gap: 12px; }
  .rules ol { margin: 0; padding: 20px 24px 20px 42px; display: grid; gap: 10px; font-size: 14px; }
  .rules ol b { font-weight: 600; }
  .swatches { padding: 20px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px 12px; align-content: start; }
  .sw i { display: block; height: 36px; border-radius: 8px; border: 1px solid rgba(20,27,45,.08); }
  .sw span { display: block; margin-top: 6px; font-size: 12px; font-weight: 500; }
  .sw code { font: 400 10.5px "JetBrains Mono", monospace; color: var(--muted); }
  .phone { padding: 20px; min-height: 330px; display: flex; flex-direction: column; }
  .phone .top { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
  .phone .mid { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 4px; }
  .phone .mid b { font-size: 17px; font-weight: 600; }
  .phone .mid span { font-size: 13px; color: var(--muted); max-width: 28ch; }
  .voted { margin-top: 12px; width: 100%; border: 2px solid var(--brand); background: var(--brand-soft); color: var(--brand-dark); font-weight: 600; font-size: 14px; border-radius: 12px; padding: 10px; }
  .btn { margin-top: 12px; background: var(--brand); color: #fff; font-weight: 600; font-size: 14px; border-radius: 12px; padding: 10px 18px; }
  .sticker { background: var(--brand); border-color: var(--brand); min-height: 330px; display: flex; flex-direction: column; overflow: hidden; }
  .sticker .big { color: #fff; font-size: 28px; line-height: 1.1; font-weight: 700; letter-spacing: -.02em; padding: 22px 22px 20px; }
  .sticker .panel { flex: 1; background: #fff; padding: 16px 22px 18px; display: flex; flex-direction: column; justify-content: space-between; gap: 12px; }
  .sticker small { font-size: 13px; line-height: 1.45; color: #475569; }
  .sticker .row { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; }
  .sticker .row svg:first-child { margin-left: -6px; }
  .sticker .code { font: 500 10px "JetBrains Mono", monospace; letter-spacing: .08em; color: var(--muted); margin-top: 6px; }
  .map { position: relative; height: 150px; border-radius: 8px; overflow: hidden; background-color: #eef0f3;
    background-image: linear-gradient(#fff 0 0), linear-gradient(#fff 0 0), linear-gradient(#fff 0 0), linear-gradient(#fff 0 0), linear-gradient(#fff 0 0);
    background-size: 100% 7px, 100% 5px, 6px 100%, 9px 100%, 5px 100%; background-position: 0 38px, 0 104px, 22% 0, 58% 0, 86% 0; background-repeat: no-repeat; }
  .map > * { position: absolute; }
  .map .d { border-radius: 50%; border: 1.5px solid #fff; }
  .tab { display: inline-flex; align-items: center; gap: 8px; background: #fff; border: 1px solid var(--line); border-bottom: 0; border-radius: 9px 9px 0 0; padding: 8px 14px 8px 10px; font-size: 12px; color: #334155; }
  .tabbar { background: #e2e8f0; border-radius: 8px; padding: 8px 10px 0; margin-top: 12px; }
  .note { margin-top: 12px; font-size: 13px; color: var(--muted); }
  @media (max-width: 820px) { .g3, .g4, .rules { grid-template-columns: 1fr 1fr; } .hero { flex-direction: column-reverse; align-items: flex-start; } }
  @media (max-width: 540px) { .g3, .g4, .rules { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="wrap">

  <header class="hero">
    <div>
      <p class="mono">Problem Pins · brand draft v0.1 · 2026-11-12</p>
      <h1>The mark, and Pip</h1>
      <p class="lede">Pip is the pin itself with two eyes. Same orange, ink and flat shapes the prototype already uses. The mark is Pip without the ground shadow, so the logo and the character are one drawing.</p>
    </div>
    ${pose('hello', 190)}
  </header>

  <section>
    <p class="mono">01 · Mark</p>
    <h2>Logo and app icon</h2>
    <div class="grid g4">
      <div class="card tile">
        <div class="stage"><span class="lockup"><span class="old">${lucidePin(16)}</span>Problem Pins</span></div>
        <p class="mono">Current · stock lucide pin</p>
      </div>
      <div class="card tile">
        <div class="stage"><span class="lockup lg">${mark(31)}Problem Pins</span></div>
        <p class="mono">Proposed · on light</p>
      </div>
      <div class="card tile dark">
        <div class="stage"><span class="lockup lg" style="color:#fff">${mark(31)}Problem Pins</span></div>
        <p class="mono">Proposed · on sidebar ink</p>
      </div>
      <div class="card tile">
        <div class="stage">${mark(64)}</div>
        <p class="mono">mark.svg</p>
      </div>
      <div class="card tile">
        <div class="stage sizes">
          ${[72, 48, 32].map((s) => `<figure>${icon(s)}<figcaption>${s}</figcaption></figure>`).join('')}
        </div>
        <p class="mono">icon.svg · app icon</p>
      </div>
      <div class="card tile">
        <div class="stage sizes">
          ${[48, 32, 24, 16].map((s) => `<figure>${favicon(s)}<figcaption>${s}</figcaption></figure>`).join('')}
        </div>
        <p class="mono">favicon.svg · larger eyes</p>
      </div>
      <div class="card tile">
        <div class="stage">
          <span class="chip" style="background:#fff; border:1px solid var(--line)">${markMono(34)}</span>
          <span class="chip" style="background:var(--brand)">${markMono(34, '#fff').replace(/pip-knockout/g, 'pip-knockout-w')}</span>
          <span class="chip" style="background:var(--ink)">${markMono(34, '#fff').replace(/pip-knockout/g, 'pip-knockout-d')}</span>
        </div>
        <p class="mono">mark-mono.svg · one colour</p>
      </div>
      <div class="card tile">
        <div class="stage">
          <div class="map" style="width:100%; height:96px">
            <span class="d" style="left:16%; top:58%; width:14px; height:14px; background:${STATUS.scheduled}"></span>
            <span class="d" style="left:74%; top:22%; width:20px; height:20px; background:${STATUS.sent_to_city}"></span>
            <span style="left:calc(50% - 14px); top:26px">${marker(28)}</span>
          </div>
        </div>
        <p class="mono">map-marker.svg · pin picker</p>
      </div>
    </div>
  </section>

  <section>
    <p class="mono">02 · Pip</p>
    <h2>Six poses, tied to the product’s own states</h2>
    <p class="lede" style="margin:-8px 0 16px">Each pose changes three things so it reads without the badge: the eyes, the lean, and how tall or squashed Pip stands.</p>
    <div class="grid g3">
      ${Object.entries(POSES)
        .map(
          ([n, p]) => `<div class="card pose">
        <div class="art">${pose(n, 150)}</div>
        <h3><i class="dot" style="background:${p.badge ? p.badge.color : BRAND}"></i>${p.label}</h3>
        <p>${USE[n]}</p>
        <p class="mono">pip-${n}.svg</p>
      </div>`,
        )
        .join('\n      ')}
    </div>
  </section>

  <section>
    <p class="mono">03 · Rules</p>
    <h2>What keeps Pip from turning into clip art</h2>
    <div class="rules">
      <ol class="card">
        <li><b>The body is always brand orange.</b> Status colour lives only in the badge, the same five colours as the map dots.</li>
        <li><b>No mouth, no arms, no legs.</b> Expression comes from the eyes, the tilt and the hop.</li>
        <li><b>Resident side and print only.</b> In the Organization view Pip appears as the logo and nowhere else.</li>
        <li><b>One Pip per screen,</b> at 48px or larger. Below that, use the mark.</li>
        <li><b>Flat fills.</b> No gradients, outlines or drop shadows beyond the ground ellipse.</li>
        <li><b>One small loop per pose.</b> Blink, sway, hop or sigh. It is CSS inside the SVG, and it stops under reduced motion.</li>
      </ol>
      <div class="card swatches">
        ${swatches.map(([n, c]) => `<div class="sw"><i style="background:${c}"></i><span>${n}</span><code>${c}</code></div>`).join('')}
      </div>
    </div>
  </section>

  <section>
    <p class="mono">04 · In use</p>
    <h2>Three places it earns its keep</h2>
    <div class="grid g3">
      <div class="card phone">
        <div class="top"><span class="lockup" style="color:var(--ink)">${mark(20)}Problem Pins</span><span>with West Side District</span></div>
        <div class="mid">
          ${pose('plus1', 120)}
          <b>Two streetlights out on W 16th St</b>
          <div class="voted">You +1’d this · 113 neighbors</div>
        </div>
        <p class="mono">Scan landing, after +1</p>
      </div>
      <div class="card phone">
        <div class="top"><span class="mono">W 22nd St · 10th to 11th Ave</span></div>
        <div class="mid">
          ${pose('hello', 110)}
          <b>Nothing pinned on this block yet</b>
          <span>Seen something broken or missing? It takes about a minute.</span>
          <div class="btn">+ Pin a problem</div>
        </div>
        <p class="mono">Empty state</p>
      </div>
      <div class="card sticker">
        <p class="big">Something broken here?</p>
        <div class="panel">
          <small>Scan to pin it, or +1 what a neighbor already reported. No app, no account.</small>
          <div class="row">
            <div>${qrPlaceholder(100)}<p class="code">Q-12 · WEST SIDE DISTRICT</p></div>
            ${pose('hello', 112)}
          </div>
        </div>
      </div>
    </div>
    <div class="tabbar"><span class="tab">${favicon(16)}Problem Pins · Prototype</span></div>
    <p class="note">QR code above is a placeholder pattern. Sticker copy and the empty-state copy are drafts for the team to rewrite.</p>
  </section>

</div>
</body>
</html>
`;
writeFileSync(join(OUT, 'preview.html'), html);
console.log(`wrote ${Object.keys(files).length} svg + preview.html to ${OUT}`);
