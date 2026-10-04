/**
 * Horario de Frésia y pedidos programados. Todo en hora de la Ciudad de México
 * (UTC−6 todo el año desde 2022, sin horario de verano).
 */
export type DayHours = { open: string; close: string } | null;
export type Schedule = {
  /** Índice 0 = domingo … 6 = sábado. null = cerrado. */
  days: DayHours[];
  /** Anticipación mínima para programar (min). */
  leadMinutes: number;
  /** Separación entre horarios disponibles (min). */
  slotMinutes: number;
  /** Cuántos días hacia adelante se puede programar (incluye hoy). */
  maxDays: number;
};

export const DEFAULT_SCHEDULE: Schedule = {
  days: [
    null, // domingo cerrado
    { open: '12:00', close: '20:30' },
    { open: '12:00', close: '20:30' },
    { open: '12:00', close: '20:30' },
    { open: '12:00', close: '20:30' },
    { open: '12:00', close: '20:00' },
    { open: '12:00', close: '20:00' },
  ],
  leadMinutes: 45,
  slotMinutes: 30,
  maxDays: 7,
};

const OFFSET_MS = -6 * 60 * 60 * 1000;
const DAY = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DAY_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTH = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Fecha y hora "de pared" en CDMX. */
export function cdmx(d: Date) {
  const l = new Date(d.getTime() + OFFSET_MS);
  return { y: l.getUTCFullYear(), mo: l.getUTCMonth(), d: l.getUTCDate(), dow: l.getUTCDay(), min: l.getUTCHours() * 60 + l.getUTCMinutes() };
}

/** Instante UTC para una fecha local de CDMX + minutos desde medianoche. */
function fromLocal(y: number, mo: number, d: number, min: number): Date {
  return new Date(Date.UTC(y, mo, d, 0, min) - OFFSET_MS);
}

export function isOpenAt(now: Date, s: Schedule): boolean {
  const t = cdmx(now);
  const h = s.days[t.dow];
  return !!h && t.min >= toMin(h.open) && t.min < toMin(h.close) - 15;
}

export function timeLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a.m.' : 'p.m.'}`;
}

export function slotLabel(iso: string, now = new Date()): string {
  const t = cdmx(new Date(iso));
  const today = cdmx(now);
  const tomorrow = cdmx(new Date(now.getTime() + 86400000));
  const day =
    t.y === today.y && t.mo === today.mo && t.d === today.d ? 'Hoy'
    : t.y === tomorrow.y && t.mo === tomorrow.mo && t.d === tomorrow.d ? 'Mañana'
    : `${DAY[t.dow].charAt(0).toUpperCase()}${DAY[t.dow].slice(1)} ${t.d} ${MONTH[t.mo]}`;
  return `${day} · ${timeLabel(t.min)}`;
}

export type SlotDay = { key: string; label: string; slots: { iso: string; label: string }[] };

/** Horarios disponibles para programar, agrupados por día. */
export function availableSlots(now: Date, s: Schedule): SlotDay[] {
  const out: SlotDay[] = [];
  const earliest = now.getTime() + s.leadMinutes * 60000;
  const base = cdmx(now);
  for (let i = 0; i < s.maxDays; i++) {
    const dayStart = fromLocal(base.y, base.mo, base.d + i, 0);
    const local = cdmx(dayStart);
    const h = s.days[local.dow];
    if (!h) continue;
    const slots: SlotDay['slots'] = [];
    // Primer horario: media hora después de abrir (preparación); último: a la hora de cerrar.
    for (let m = toMin(h.open) + s.slotMinutes; m <= toMin(h.close); m += s.slotMinutes) {
      const at = fromLocal(local.y, local.mo, local.d, m);
      if (at.getTime() < earliest) continue;
      slots.push({ iso: at.toISOString(), label: timeLabel(m) });
    }
    if (slots.length) {
      const label = slotLabel(slots[0].iso, now).split(' · ')[0];
      out.push({ key: `${local.y}-${local.mo + 1}-${local.d}`, label, slots });
    }
  }
  return out;
}

export function isValidSlot(iso: string, now: Date, s: Schedule): boolean {
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return false;
  // Tolerancia de 5 min por si el cliente tardó en confirmar.
  const relaxed = new Date(now.getTime() - 5 * 60000);
  return availableSlots(relaxed, s).some((d) => d.slots.some((x) => Date.parse(x.iso) === target));
}

/** Próxima apertura, p. ej. «hoy a las 12:00 p.m.» o «el lunes a las 12:00 p.m.». */
export function nextOpening(now: Date, s: Schedule): string | null {
  const base = cdmx(now);
  for (let i = 0; i < 8; i++) {
    const local = cdmx(fromLocal(base.y, base.mo, base.d + i, 0));
    const h = s.days[local.dow];
    if (!h) continue;
    if (i === 0 && base.min >= toMin(h.open)) continue;
    const when = i === 0 ? 'hoy' : i === 1 ? 'mañana' : `el ${DAY_LONG[local.dow]}`;
    return `${when} a las ${timeLabel(toMin(h.open))}`;
  }
  return null;
}

/** Texto del horario para mostrar, a partir de los días. */
export function scheduleText(s: Schedule): string {
  const names = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups: { from: number; to: number; h: DayHours }[] = [];
  for (const d of order) {
    const h = s.days[d];
    const last = groups.at(-1);
    if (last && JSON.stringify(last.h) === JSON.stringify(h)) last.to = d;
    else groups.push({ from: d, to: d, h });
  }
  return groups
    .map((g) => {
      const who = g.from === g.to ? names[g.from] : `${names[g.from]} a ${names[g.to].toLowerCase()}`;
      return g.h ? `${who}: ${timeLabel(toMin(g.h.open))} – ${timeLabel(toMin(g.h.close))}` : `${who}: cerrado`;
    })
    .join('\n');
}
