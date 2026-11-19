import { config } from '../config';

/** The short link printed on a poster and encoded in its QR code. */
export function shortLink(code: string, base = config.publicUrl) {
  return `${base}/q/${code}`;
}

/** The short link without the scheme, for printing as text under the code. */
export function displayLink(url: string) {
  return url.replace(/^https?:\/\//, '');
}

// Medium error correction survives scuffs and a little rain without making the code dense.
const OPTIONS = { errorCorrectionLevel: 'M' as const, margin: 2, color: { dark: '#141b2dff', light: '#ffffffff' } };

// `qrcode` is loaded on first use, so screens that only show a link (the dashboard) don't download it.
const loadQr = () => import('qrcode').then((m) => m.default);

export async function qrSvg(text: string): Promise<string> {
  return (await loadQr()).toString(text, { ...OPTIONS, type: 'svg' });
}

/** A PNG data URL, `size` pixels square: large enough to print sharp at poster size. */
export async function qrPng(text: string, size = 1200): Promise<string> {
  return (await loadQr()).toDataURL(text, { ...OPTIONS, width: size });
}
