import { load, remove, save } from './storage';

const KEY = 'fo.src.v1';
const TTL = 30 * 24 * 3600 * 1000;

/** Guarda el edificio del QR (?src=) y lo quita de la URL. */
export function captureSource() {
  const url = new URL(window.location.href);
  const src = url.searchParams.get('src');
  if (!src || !/^[a-z0-9-]{1,40}$/.test(src)) return;
  save(KEY, { slug: src, at: Date.now() });
  url.searchParams.delete('src');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

/** Edificio de origen si el cliente llegó por un QR en los últimos 30 días. */
export function currentSource(): string | null {
  const s = load<{ slug: string; at: number } | null>(KEY, null);
  if (!s) return null;
  if (Date.now() - s.at > TTL) {
    remove(KEY);
    return null;
  }
  return s.slug;
}
