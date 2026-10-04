import { useEffect, useRef, useState } from 'react';
import { compressPhoto } from '../lib/photo';
import { money } from '../lib/format';
import { ApiError } from '../lib/api';
import type { AdminOrder } from '../../shared/types';

/**
 * Paso final de un pedido a domicilio: foto de entrega (obligatoria) y confirmar.
 * La foto se sube primero; luego se marca entregado (y cobrado si era en efectivo).
 */
export function DeliveryProof({ order, collect, busy, onConfirm, onCancel }: {
  order: AdminOrder;
  collect: boolean;
  busy: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(order.deliveryPhotoAt ? `/api/admin/orders/${order.id}/delivery-photo?v=${order.deliveryPhotoAt}` : null);
  const [uploading, setUploading] = useState(false);
  const [photoAt, setPhotoAt] = useState<string | null>(order.deliveryPhotoAt);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const hasPhoto = Boolean(photoAt) && !uploading;

  useEffect(() => {
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const blob = await compressPhoto(file);
      setPreview(URL.createObjectURL(blob));
      const res = await fetch(`/api/admin/orders/${order.id}/delivery-photo`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob, credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, String(body.error ?? 'No se pudo subir la foto.'));
      setPhotoAt(body.order?.deliveryPhotoAt ?? new Date().toISOString());
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'No se pudo subir la foto. Revisa la señal e intenta de nuevo.');
      setPreview(null);
      setPhotoAt(null);
    }
    setUploading(false);
  }

  return (
    <section ref={box} className="card stack delivery-proof" aria-labelledby="proof-title">
      <h2 id="proof-title">📷 Foto de entrega</h2>
      <p className="muted">Toma una foto del pedido entregado (en recepción, en la puerta o en manos del cliente). El cliente la verá como comprobante.</p>

      {preview ? (
        <img src={preview} alt="Foto de entrega" className="proof-img" />
      ) : (
        <button type="button" className="proof-empty" onClick={() => input.current?.click()} disabled={uploading}>
          <span aria-hidden="true" style={{ fontSize: 40 }}>📷</span>
          Tomar foto
        </button>
      )}
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />

      {uploading && <p className="small" role="status">Subiendo foto…</p>}
      {error && <p className="error-text" role="alert">{error}</p>}

      <button type="button" className="btn primary block big-action" disabled={!hasPhoto || busy} onClick={onConfirm}>
        <span className="big-action-hint">{hasPhoto ? 'Último paso' : 'Primero toma la foto'}</span>
        <span>✅ Confirmar entrega{collect && order.total != null ? ` y cobro ${money(order.total)}` : ''}</span>
      </button>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {preview && (
          <button type="button" className="btn ghost small" disabled={uploading} onClick={() => input.current?.click()}>
            Volver a tomar
          </button>
        )}
        <button type="button" className="linkbtn" onClick={onCancel}>Todavía no</button>
      </div>
    </section>
  );
}
