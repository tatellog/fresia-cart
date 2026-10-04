import { useEffect, useState } from 'react';
import { api } from './api';

export type PostalInfo = { cp: string; alcaldia: string; estado: string; colonias: { name: string; tipo: string }[] };
type PostalResponse = ({ found: true } & PostalInfo) | { found: false; catalog: boolean };
export type PostalState =
  | { state: 'idle' | 'loading' | 'unknown' }
  | { state: 'not_found' }
  | { state: 'found'; info: PostalInfo };

export const POSTAL_NOT_FOUND = 'Ese código postal no existe en la Ciudad de México. Revísalo.';

/** Busca el código postal en el catálogo de SEPOMEX al completar los 5 dígitos. */
export function usePostalCode(cp: string): PostalState {
  const [state, setState] = useState<PostalState>({ state: 'idle' });
  useEffect(() => {
    if (!/^\d{5}$/.test(cp)) {
      setState({ state: 'idle' });
      return;
    }
    const ctrl = new AbortController();
    setState({ state: 'loading' });
    api<PostalResponse>(`/api/postal-codes/${cp}`, { signal: ctrl.signal }).then(
      (r) => setState(r.found ? { state: 'found', info: r } : r.catalog ? { state: 'not_found' } : { state: 'unknown' }),
      // Si falla la consulta no se bloquea: se escribe la colonia a mano y el servidor valida.
      (e) => e.name !== 'AbortError' && setState({ state: 'unknown' }),
    );
    return () => ctrl.abort();
  }, [cp]);
  return state;
}
