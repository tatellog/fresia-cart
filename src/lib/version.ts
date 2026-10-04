import { useEffect, useState } from 'react';

/** Archivo principal con el que se cargó esta página (cambia en cada despliegue). */
function currentBundle(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return s ? new URL(s.src).pathname : null;
}

async function latestBundle(): Promise<string | null> {
  try {
    const html = await (await fetch('/', { cache: 'no-store' })).text();
    return html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Detecta si se publicó una versión nueva mientras la página seguía abierta.
 * Revisa cada minuto y al volver a la pestaña.
 */
export function useNewVersion(): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const mine = currentBundle();
    if (!mine) return; // en desarrollo (vite) no hay bundle
    const check = async () => {
      const latest = await latestBundle();
      if (latest && latest !== mine) setStale(true);
    };
    const id = setInterval(check, 60_000);
    const onVis = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return stale;
}
