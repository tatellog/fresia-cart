import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { MenuResponse } from '../../shared/types';
import { api } from './api';

type MenuState = { data: MenuResponse | null; error: string | null; reload: () => void };
const Ctx = createContext<MenuState>({ data: null, error: null, reload: () => undefined });

export function MenuProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<MenuResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    api<MenuResponse>('/api/menu').then(setData, (e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return <Ctx.Provider value={{ data, error, reload }}>{children}</Ctx.Provider>;
}

export const useMenu = () => useContext(Ctx);
