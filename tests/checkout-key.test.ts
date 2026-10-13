import { beforeEach, describe, expect, it } from 'vitest';

// localStorage mínimo para probar la lógica del navegador en Node.
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

// Código del navegador (fuera del proyecto de tipos del servidor): se importa por ruta dinámica.
const browserLib = '../src/lib/checkout';
const { idempotencyKeyFor, orderPlaced } = (await import(browserLib)) as { idempotencyKeyFor: (fp: string) => string; orderPlaced: () => void };

describe('llave del pedido en el navegador', () => {
  beforeEach(() => mem.clear());

  it('se conserva mientras no haya respuesta (reintento tras timeout = mismo pedido)', () => {
    const k1 = idempotencyKeyFor('carrito-A');
    const k2 = idempotencyKeyFor('carrito-A'); // reintento: la primera respuesta se perdió
    expect(k2).toBe(k1);
  });

  it('tras un pedido confirmado se libera: el mismo carrito otro día es un pedido NUEVO', () => {
    const k1 = idempotencyKeyFor('carrito-A');
    orderPlaced();
    expect(idempotencyKeyFor('carrito-A')).not.toBe(k1);
  });

  it('otro carrito = otra llave', () => {
    expect(idempotencyKeyFor('carrito-A')).not.toBe(idempotencyKeyFor('carrito-B'));
  });
});
