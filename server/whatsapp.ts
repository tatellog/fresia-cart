import type { Config } from './env';

/**
 * Envío de avisos de WhatsApp AL NEGOCIO (no al cliente).
 *
 * - meta: WhatsApp Cloud API oficial. Los mensajes iniciados por el negocio
 *   requieren una plantilla aprobada (ver README: «pedido_fresia», 6 variables + botón).
 *   Si la plantilla aún no está aprobada, se manda como texto (solo llega si el receptor
 *   escribió al número del negocio en las últimas 24 h).
 * - callmebot: servicio gratuito para recibir mensajes en TU número
 *   (https://www.callmebot.com/blog/free-api-whatsapp-messages/). Es un tercero:
 *   el texto del aviso pasa por sus servidores.
 */
export type WhatsAppMessage = { to: string; text: string; params: string[]; buttonParam?: string };

export function whatsappConfigured(cfg: Config): boolean {
  if (cfg.whatsappProvider === 'meta') return Boolean(cfg.metaWhatsappToken && cfg.metaWhatsappPhoneNumberId);
  if (cfg.whatsappProvider === 'callmebot') return Boolean(cfg.callmebotApiKey);
  return false;
}

export async function sendWhatsApp(cfg: Config, msg: WhatsAppMessage): Promise<void> {
  const to = msg.to.replace(/\D/g, '');
  if (cfg.whatsappProvider === 'meta') {
    const post = (payload: object) =>
      fetch(`https://graph.facebook.com/v21.0/${cfg.metaWhatsappPhoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.metaWhatsappToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, ...payload }),
        signal: AbortSignal.timeout(10000),
      });
    const res = await post({
      type: 'template',
      template: {
        name: cfg.metaWhatsappTemplate || 'pedido_fresia',
        language: { code: cfg.metaWhatsappTemplateLang },
        components: [
          { type: 'body', parameters: msg.params.map((t) => ({ type: 'text', text: oneLine(t) })) },
          // Botón «Ver pedido»: URL base fija en la plantilla + id del pedido.
          ...(msg.buttonParam && cfg.metaWhatsappTemplateButton
            ? [{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: msg.buttonParam }] }]
            : []),
        ],
      },
    });
    if (res.ok) return;
    const err = await res.text();
    // Plantilla aún no creada/aprobada: texto normal. Meta solo lo entrega si el número
    // receptor escribió al número del negocio en las últimas 24 h.
    if (/132001|132000|template/i.test(err)) {
      const fallback = await post({ type: 'text', text: { body: msg.text.slice(0, 4000), preview_url: false } });
      if (fallback.ok) return;
      throw new Error(`Meta (texto) ${fallback.status}: ${(await fallback.text()).slice(0, 200)}`);
    }
    throw new Error(`Meta ${res.status}: ${err.slice(0, 200)}`);
  }
  if (cfg.whatsappProvider === 'callmebot') {
    const url = new URL('https://api.callmebot.com/whatsapp.php');
    url.searchParams.set('phone', to);
    url.searchParams.set('text', msg.text);
    url.searchParams.set('apikey', cfg.callmebotApiKey);
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const body = await res.text();
    if (!res.ok || /error|invalid/i.test(body.slice(0, 500))) throw new Error(`CallMeBot ${res.status}: ${body.replace(/<[^>]+>/g, ' ').slice(0, 160)}`);
    return;
  }
  throw new Error('WhatsApp no configurado');
}

/** Meta rechaza saltos de línea, tabuladores y más de 4 espacios seguidos en las variables. */
const oneLine = (s: string) => s.replace(/[\n\t]+/g, ' · ').replace(/ {4,}/g, '   ').slice(0, 900);
