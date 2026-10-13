import { load, save } from './storage';
import { uuid } from './uuid';
import { activeGroup } from './groupState';

/** Medición anónima: un id aleatorio por navegador y la campaña de origen. Nada de nombre ni teléfono. */
const VISITOR = 'fo.vid.v1';
const ATTRIBUTION = 'fo.att.v1';
const TTL = 30 * 24 * 3600 * 1000;

export type Attribution = { source: string | null; medium: string | null; campaign: string | null };
type Stored = Attribution & { at: number };
export type Mode = 'individual' | 'equipo' | 'regalo';
type Event = 'visita' | 'ver_producto' | 'agregar_carrito' | 'crear_equipo' | 'unirse_equipo' | 'iniciar_checkout';

const tag = (v: string | null) => (v ? v.trim().toLowerCase().slice(0, 60) || null : null);

/**
 * Lee utm_source / utm_medium / utm_campaign (y ?src= de los QR) de la URL al entrar.
 * Se queda la última campaña con la que llegó en los últimos 30 días; los parámetros se quitan de la URL.
 */
export function captureAttribution() {
  const url = new URL(window.location.href);
  const p = url.searchParams;
  const source = tag(p.get('utm_source') ?? p.get('src'));
  if (source) save(ATTRIBUTION, { source, medium: tag(p.get('utm_medium')), campaign: tag(p.get('utm_campaign')), at: Date.now() } satisfies Stored);
  const had = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].filter((k) => p.has(k));
  if (had.length) {
    had.forEach((k) => p.delete(k));
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
}

export function attribution(): Attribution | null {
  const a = load<Stored | null>(ATTRIBUTION, null);
  if (!a || Date.now() - a.at > TTL) return null;
  return { source: a.source, medium: a.medium, campaign: a.campaign };
}

function visitor(): string {
  let v = load<string | null>(VISITOR, null);
  if (!v) {
    v = uuid();
    save(VISITOR, v);
  }
  return v;
}

/** Modalidad actual: agregando a un pedido de equipo o comprando para uno mismo. */
export const currentMode = (): Mode => (activeGroup() ? 'equipo' : 'individual');

/** Manda un evento sin bloquear la interfaz; si falla, no pasa nada. */
export function track(event: Event, extra: { mode?: Mode | null; productId?: string } = {}) {
  try {
    const body = JSON.stringify({ event, visitor: visitor(), attribution: attribution(), mode: extra.mode === undefined ? currentMode() : extra.mode, productId: extra.productId ?? null });
    void fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {
    /* la medición nunca rompe la tienda */
  }
}

/** Una visita por pestaña (no por cada página). */
export function trackVisit() {
  try {
    if (sessionStorage.getItem('fo.visit')) return;
    sessionStorage.setItem('fo.visit', '1');
  } catch {
    /* sin sessionStorage: cuenta cada carga */
  }
  track('visita', { mode: null });
}

/** Primera vez que esta persona agrega algo a un pedido de equipo = se unió. */
export function trackGroupJoin(code: string) {
  const joined = load<string[]>('fo.joined.v1', []);
  if (joined.includes(code)) return;
  save('fo.joined.v1', [...joined.slice(-20), code]);
  track('unirse_equipo', { mode: 'equipo' });
}
