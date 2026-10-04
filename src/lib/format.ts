export { money } from '../../shared/money';
import type { BusinessInfo } from '../../shared/types';

export function whatsappLink(business: BusinessInfo, text: string): string | null {
  if (!business.whatsapp) return null;
  return `https://wa.me/${business.whatsapp}?text=${encodeURIComponent(text)}`;
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}
