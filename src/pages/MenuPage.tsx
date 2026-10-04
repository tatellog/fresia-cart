import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { ORDER_LABEL } from '../../shared/status';
import type { OrderStatus, PublicOrder } from '../../shared/types';
import { useMenu } from '../lib/menu';
import { money } from '../lib/format';
import { recentOrders } from '../lib/checkout';
import { CartBar, DemoBanner, Footer, GroupModeBanner, LoadError } from '../components/ui';
import { activeGroup } from '../lib/groupState';
import { minQtyFor } from '../../shared/pricing';
import type { MenuRules } from '../../shared/types';
import { isOpenAt, nextOpening } from '../../shared/schedule';
import type { BusinessInfo, MenuResponse, Product } from '../../shared/types';

export default function MenuPage() {
  const { data, error, reload } = useMenu();
  const added = (useLocation().state as { added?: string } | null)?.added;
  const active = useActiveOrder();

  return (
    <>
      <DemoBanner />
      <GroupModeBanner />
      <main className="page wide">
        <section className="hero">
          <img src="/brand/fresia-logo.svg" alt="Frésia, fresas con crema" className="logo" width={132} height={196} />
          <h1>Fresas con crema para tu oficina</h1>
          <p className="muted">Pide para todo el equipo. Sin crear cuenta.</p>
          {data && !activeGroup() && (data.rules.minQtyPerItem > 1 || data.rules.minFresias > 1) && (
            <p className="badge min-banner">
              {data.rules.minQtyPerItem > 1 ? `Mínimo ${data.rules.minQtyPerItem} piezas por producto · combos desde 1` : `Pedido mínimo: ${data.rules.minFresias} Frésias`}
            </p>
          )}
          <Link to="/equipo/nuevo" className="btn secondary small">👥 Pedido de equipo</Link>
          {data && !isOpenAt(new Date(), data.schedule) && (
            <p className="notice closed-banner small">
              Ahora estamos cerrados{nextOpening(new Date(), data.schedule) ? `; abrimos ${nextOpening(new Date(), data.schedule)}` : ''}. Puedes programar tu pedido.
            </p>
          )}
          {active && (
            <Link to={`/pedido/${active.number}?t=${active.token}`} className="btn ghost small">
              Ver mi pedido {active.number} · {ORDER_LABEL[active.status]}
            </Link>
          )}
        </section>

        <div aria-live="polite" className="sr-only">{added ? `${added} se agregó al carrito` : ''}</div>
        {added && (
          <div className="notice ok" style={{ marginTop: 8 }}>
            <strong>{added}</strong> se agregó al carrito.
          </div>
        )}

        <section aria-labelledby="menu-title" className="stack-lg" style={{ marginTop: 24 }}>
          <h2 id="menu-title" className="sr-only">Menú</h2>

          {error && <LoadError message={error} retry={reload} />}
          {!data && !error && <MenuSkeleton />}
          {data &&
            sections(data.products).map(([title, items]) => (
              <section key={title} className="stack" aria-labelledby={`s-${title}`}>
                <h2 id={`s-${title}`}>{title}</h2>
                <div className="grid">
                  {items.map((p) => (
                    <ProductCard key={p.id} product={p} rules={data.rules} />
                  ))}
                </div>
              </section>
            ))}
        </section>

        {data && <BusinessSection business={data.business} delivery={data.delivery} />}
        <Footer />
      </main>
      <CartBar />
    </>
  );
}

/** Agrupa por sección, en el orden del primer producto de cada una. */
function sections(products: Product[]): [string, Product[]][] {
  const map = new Map<string, Product[]>();
  for (const p of products) map.set(p.section, [...(map.get(p.section) ?? []), p]);
  return [...map.entries()];
}

function ProductCard({ product: p, rules }: { product: Product; rules: MenuRules }) {
  // En pedido de equipo no hay mínimo.
  const min = activeGroup() ? 1 : minQtyFor(p, rules);
  const from = Math.min(...p.sizes.map((s) => s.price));
  const content = (
    <>
      <div className="photo">
        <img src={p.image} alt="" loading="lazy" decoding="async" width={600} height={450} />
        {!p.available ? <span className="badge">Agotado hoy</span> : p.example && <span className="badge example">Ejemplo</span>}
      </div>
      <div className="meta">
        <div>
          <h3>{p.name}</h3>
          <p className="muted small desc">{p.description}</p>
          {min > 1 && <p className="min-tag">Mínimo {min} piezas</p>}
        </div>
        <p className="price" style={{ whiteSpace: 'nowrap' }}>
          {(p.sizes.length > 1 || p.combo) && <span className="muted small" style={{ fontWeight: 400 }}>desde </span>}
          {money(from)}
        </p>
      </div>
    </>
  );
  if (!p.available) {
    return (
      <div className="product-card soldout" aria-label={`${p.name}, agotado hoy`}>
        {content}
      </div>
    );
  }
  return (
    <Link to={`/producto/${p.id}`} className="product-card" aria-label={`${p.name}, desde ${money(from)}`}>
      {content}
    </Link>
  );
}

function MenuSkeleton() {
  return (
    <div className="grid" aria-busy="true" aria-label="Cargando menú">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="stack">
          <div className="skeleton" style={{ aspectRatio: '4 / 3' }} />
          <div className="skeleton" style={{ height: 20, width: '60%' }} />
        </div>
      ))}
    </div>
  );
}

function BusinessSection({ business: b, delivery: d }: { business: BusinessInfo; delivery: MenuResponse['delivery'] }) {
  const pending = <span className="muted">Pendiente de confirmar</span>;
  return (
    <section aria-labelledby="info-title" className="card flat stack" style={{ marginTop: 48 }}>
      <div className="row between">
        <h2 id="info-title">Frésia</h2>
        {b.example && <span className="badge example">Datos por confirmar</span>}
      </div>
      <dl className="info-list">
        <div>
          <dt>Ubicación</dt>
          <dd>
            {b.address || pending}
            {b.mapsUrl && (
              <>
                {' · '}
                <a href={b.mapsUrl} target="_blank" rel="noopener noreferrer">
                  Ver mapa
                </a>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Horario</dt>
          <dd style={{ whiteSpace: 'pre-line' }}>{b.hours || pending}</dd>
        </div>
        <div>
          <dt>Contacto</dt>
          <dd>
            {b.whatsapp ? (
              <a href={`https://wa.me/${b.whatsapp}`} target="_blank" rel="noopener noreferrer">
                WhatsApp
              </a>
            ) : (
              pending
            )}
            {b.email && (
              <>
                {' · '}
                <a href={`mailto:${b.email}`}>{b.email}</a>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Entregas</dt>
          <dd>
            {[d.deliveryEnabled && 'A domicilio en zonas de cobertura', d.pickupEnabled && 'Recoger en Frésia'].filter(Boolean).join(' · ') ||
              'Por ahora no recibimos pedidos en línea'}
            <span className="muted small" style={{ display: 'block' }}>
              Verás la tarifa y el tiempo estimado antes de pagar.
            </span>
          </dd>
        </div>
      </dl>
    </section>
  );
}

const FINISHED: OrderStatus[] = ['entregado', 'cancelado'];

/** Pedido reciente de este celular que sigue en curso (los entregados o cancelados no se muestran). */
function useActiveOrder() {
  const [active, setActive] = useState<{ number: string; token: string; status: OrderStatus } | null>(null);
  useEffect(() => {
    const candidates = recentOrders().filter((o) => Date.now() - Date.parse(o.at) < 24 * 3600 * 1000);
    let alive = true;
    (async () => {
      for (const o of candidates) {
        try {
          const r = await api<{ order: PublicOrder }>(`/api/orders/${encodeURIComponent(o.number)}?t=${encodeURIComponent(o.token)}`);
          if (!FINISHED.includes(r.order.orderStatus)) {
            if (alive) setActive({ number: o.number, token: o.token, status: r.order.orderStatus });
            return;
          }
        } catch {
          /* pedido de otra base o sin conexión: se omite */
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return active;
}
