/** Datos para factura (CFDI 4.0). Deben coincidir con la Constancia de Situación Fiscal. */
export type InvoiceData = {
  rfc: string;
  name: string;
  regime: string;
  zip: string;
  use: string;
  email: string;
};

export const REGIMES: { code: string; label: string }[] = [
  { code: '601', label: '601 · General de Ley Personas Morales' },
  { code: '603', label: '603 · Personas Morales con Fines no Lucrativos' },
  { code: '605', label: '605 · Sueldos y Salarios' },
  { code: '606', label: '606 · Arrendamiento' },
  { code: '612', label: '612 · Personas Físicas con Actividades Empresariales y Profesionales' },
  { code: '616', label: '616 · Sin obligaciones fiscales' },
  { code: '621', label: '621 · Incorporación Fiscal' },
  { code: '626', label: '626 · Régimen Simplificado de Confianza' },
];

export const CFDI_USES: { code: string; label: string }[] = [
  { code: 'G03', label: 'G03 · Gastos en general' },
  { code: 'G01', label: 'G01 · Adquisición de mercancías' },
  { code: 'S01', label: 'S01 · Sin efectos fiscales' },
];

export const RFC_RE = /^([A-ZÑ&]{3,4})\d{6}([A-Z\d]{3})$/;

export function normalizeInvoice(i: InvoiceData): InvoiceData {
  return {
    rfc: i.rfc.toUpperCase().replace(/[\s-]/g, ''),
    name: i.name.trim().toUpperCase(),
    regime: i.regime,
    zip: i.zip.trim(),
    use: i.use,
    email: i.email.trim().toLowerCase(),
  };
}

/** Errores por campo, en español; vacío si todo está bien. */
export function invoiceErrors(raw: InvoiceData): Partial<Record<keyof InvoiceData, string>> {
  const i = normalizeInvoice(raw);
  const e: Partial<Record<keyof InvoiceData, string>> = {};
  if (!RFC_RE.test(i.rfc)) e.rfc = 'RFC inválido (12 caracteres para empresas, 13 para personas).';
  if (i.name.length < 2) e.name = 'Escribe la razón social tal como aparece en la constancia.';
  if (!REGIMES.some((r) => r.code === i.regime)) e.regime = 'Elige el régimen fiscal.';
  if (!/^\d{5}$/.test(i.zip)) e.zip = 'El código postal fiscal tiene 5 dígitos.';
  if (!CFDI_USES.some((u) => u.code === i.use)) e.use = 'Elige el uso del CFDI.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email)) e.email = 'Escribe un correo válido para enviarte la factura.';
  // Personas morales (12) no pueden usar regímenes de personas físicas y viceversa.
  const moral = i.rfc.length === 12;
  if (!e.rfc && !e.regime && moral && ['605', '606', '612', '616', '621'].includes(i.regime)) e.regime = 'Ese régimen es de personas físicas; revisa el RFC.';
  if (!e.rfc && !e.regime && !moral && ['601', '603'].includes(i.regime)) e.regime = 'Ese régimen es de empresas; revisa el RFC.';
  return e;
}
