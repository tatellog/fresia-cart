const fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function money(cents: number): string {
  return fmt.format(cents / 100);
}

/** "45.50" → 4550. Devuelve null si no es un importe válido. */
export function parseMoney(input: string): number | null {
  const clean = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(parseFloat(clean) * 100);
}
