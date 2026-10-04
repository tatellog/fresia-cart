import { uuid } from './uuid';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { CartLineInput } from '../../shared/types';
import { priceCart } from '../../shared/pricing';
import { DEFAULT_RULES_CLIENT } from './rules';
import { load, save } from './storage';
import { useMenu } from './menu';

export type CartLine = CartLineInput & { lineId: string };

type CartState = {
  lines: CartLine[];
  add: (line: CartLineInput) => void;
  update: (lineId: string, patch: Partial<CartLineInput>) => void;
  remove: (lineId: string) => void;
  clear: () => void;
  count: number;
  /** Subtotal estimado con el menú actual. El servidor recalcula antes de cobrar. */
  subtotal: number;
  /** Frésias que cuentan para el pedido mínimo. */
  fresias: number;
  problems: Map<string, string>;
};

const KEY = 'fo.cart.v1';
const Ctx = createContext<CartState | null>(null);

const newId = uuid;

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => load<CartLine[]>(KEY, []));
  const { data } = useMenu();

  useEffect(() => save(KEY, lines), [lines]);

  // Sincroniza entre pestañas.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setLines(load<CartLine[]>(KEY, []));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo<CartState>(() => {
    const problems = new Map<string, string>();
    let subtotal = 0;
    let fresias = 0;
    if (data) {
      const priced = priceCart(lines, data.products, data.toppings, data.rules ?? DEFAULT_RULES_CLIENT);
      priced.errors.forEach((e) => problems.set(lines[e.index].lineId, e.message));
      subtotal = priced.subtotal;
      fresias = priced.fresias;
    }
    return {
      lines,
      problems,
      subtotal,
      fresias,
      count: lines.reduce((s, l) => s + l.qty, 0),
      add: (line) =>
        setLines((prev) => {
          // Mismo producto, tamaño, toppings y destinatario → suma cantidades.
          const same = prev.find(
            (l) => l.productId === line.productId && l.sizeId === line.sizeId && (l.forWhom ?? '') === (line.forWhom ?? '') &&
              [...l.toppingIds].sort().join() === [...line.toppingIds].sort().join() &&
              JSON.stringify(l.choices ?? null) === JSON.stringify(line.choices ?? null),
          );
          if (same) return prev.map((l) => (l === same ? { ...l, qty: Math.min(50, l.qty + line.qty) } : l));
          return [...prev, { ...line, lineId: newId() }];
        }),
      update: (lineId, patch) => setLines((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l))),
      remove: (lineId) => setLines((prev) => prev.filter((l) => l.lineId !== lineId)),
      clear: () => setLines([]),
    };
  }, [lines, data]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { toLineInput } from '../../shared/cart';

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error('CartProvider faltante');
  return c;
}
