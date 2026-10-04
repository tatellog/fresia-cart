/**
 * Reduce una foto en el celular antes de subirla: máx. 1280 px y JPEG ~75%.
 * Una foto de cámara de 3–5 MB queda en ~150–300 KB (rápido aun con mala señal).
 */
export async function compressPhoto(file: File, maxSide = 1024, quality = 0.65): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions).catch(() => createImageBitmap(file));
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la foto.'))), 'image/jpeg', quality));
}
