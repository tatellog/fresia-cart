import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CartIcon, Wordmark } from './ui';

/** Encabezado de la tienda: marca a la izquierda; carrito y menú a la derecha. */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <header className="site-header">
      <div className="inner">
        <Link to="/" className="wordmark" aria-label="Frésia, inicio"><Wordmark height={30} /></Link>
        <div className="actions" ref={ref}>
          <CartIcon />
          <button type="button" className="icon-btn" aria-label="Menú" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((o) => !o)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M5 9h14M9 15h10" />
            </svg>
          </button>
          {open && (
            <nav id="site-menu" className="site-menu" aria-label="Menú del sitio" onClick={() => setOpen(false)}>
              <Link to="/equipo/nuevo">👥 Crear pedido de equipo</Link>
              <a href="/#menu">🍓 Ver el menú</a>
              <Link to="/mis-pedidos">🧾 Mis pedidos</Link>
              <a href="/#info">📍 Ubicación y horario</a>
              <hr />
              <Link to="/legal/entregas">Entregas</Link>
              <Link to="/legal/cancelaciones">Cancelaciones y reembolsos</Link>
              <Link to="/legal/privacidad">Aviso de privacidad</Link>
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
