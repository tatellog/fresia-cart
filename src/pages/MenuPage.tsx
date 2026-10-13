import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { ORDER_LABEL } from '../../shared/status';
import type { OrderStatus, PublicOrder } from '../../shared/types';
import { useMenu } from '../lib/menu';
import { money } from '../lib/format';
import { recentOrders } from '../lib/checkout';
import { CartBar, DemoBanner, Footer, GroupModeBanner, LoadError } from '../components/ui';
import { SiteHeader } from '../components/SiteHeader';
import { activeGroup, myGroups } from '../lib/groupState';
import { GIFT_KEY, emptyGift } from '../components/GiftFields';
import { load as loadStored, save } from '../lib/storage';
import { minQtyFor } from '../../shared/pricing';
import type { MenuRules } from '../../shared/types';
import { isOpenAt, nextOpening } from '../../shared/schedule';
import type { BusinessInfo, MenuResponse, Product } from '../../shared/types';

export default function MenuPage() {
  const { data, error, reload } = useMenu();
  const added = (useLocation().state as { added?: string } | null)?.added;
  const active = useActiveOrder();
  const group = activeGroup();

  return (
    <>
      <DemoBanner />
      <SiteHeader />
      <GroupModeBanner />
      <main className="page wide">
        {active && (
          <Link to={`/pedido/${active.number}?t=${active.token}`} className="active-order">
            <span>Tu pedido <strong>{active.number}</strong> · {ORDER_LABEL[active.status]}</span>
            <span aria-hidden="true">Ver →</span>
          </Link>
        )}

        {group ? (
          <section className="hero-team">
            <p className="eyebrow">Pedido de equipo</p>
            <h1>Elige lo tuyo para «{group.name}»</h1>
            <p className="muted">Toca un producto y agrégalo; llega todo junto con tu equipo.</p>
          </section>
        ) : (
          <section className="home-hero" aria-labelledby="hero-title">
            <div className="copy">
              <p className="eyebrow">Frésia Office</p>
              <h1 id="hero-title">El break sabe mejor en equipo.</h1>
              <p className="lead">Cada quien elige sus fresas. Nosotros llevamos el pedido a tu oficina.</p>
            </div>
            <img className="hero-photo" src="/images/combo-pausa.jpg" alt="Frésias clásicas y de chocolate listas para la oficina" width={1200} height={750} fetchPriority="high" />
            <div className="ctas">
              <Link to="/equipo/nuevo" className="btn primary cta-main">
                <span>Crear pedido de equipo</span>
                <small>Invita a tus compañeros</small>
              </Link>
              <a href="#menu" className="btn outline cta-alt" onClick={(e) => { e.preventDefault(); document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' }); }}>
                Pedir solo para mí
              </a>
              <ol className="how" aria-label="Cómo funciona el pedido de equipo">
                <li><b>1</b> Crea</li>
                <li><b>2</b> Comparte el enlace</li>
                <li><b>3</b> Reciban juntos</li>
              </ol>
            </div>
            {data && <HomeFacts data={data} />}
            {data && !isOpenAt(new Date(), data.schedule) && (
              <p className="notice closed-banner small">
                Ahora estamos cerrados{nextOpening(new Date(), data.schedule) ? `; abrimos ${nextOpening(new Date(), data.schedule)}` : ''}{nextOpening(new Date(), data.schedule)?.endsWith('.') ? '' : '.'} Puedes programar tu pedido.
              </p>
            )}
            {data?.features?.fresigrama && data.delivery.deliveryEnabled && <GiftCta />}
            {(recentOrders().length > 0 || myGroups().length > 0) && (
              <Link to="/mis-pedidos" className="linkbtn small" style={{ justifySelf: 'center' }}>Mis pedidos · repetir uno anterior</Link>
            )}
          </section>
        )}

        <div aria-live="polite" className="sr-only">{added ? `${added} se agregó al carrito` : ''}</div>
        {added && (
          <div className="notice ok" style={{ marginTop: 8 }}>
            <strong>{added}</strong> se agregó al carrito.
          </div>
        )}

        <section id="menu" aria-labelledby="menu-title" className="stack-lg menu-block">
          <div className="menu-head">
            <h2 id="menu-title">Menú</h2>
            {data && sections(data.products).length > 1 && (
              <nav className="section-nav" aria-label="Secciones del menú">
                {sections(data.products).map(([title]) => (
                  <a key={title} href={`#s-${slug(title)}`} onClick={(e) => { e.preventDefault(); document.getElementById(`s-${slug(title)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{title}</a>
                ))}
              </nav>
            )}
          </div>

          {error && <LoadError message={error} retry={reload} />}
          {!data && !error && <MenuSkeleton />}
          {data &&
            sections(data.products).map(([title, items]) => (
              <section key={title} className="stack" aria-labelledby={`s-${slug(title)}`}>
                <h3 id={`s-${slug(title)}`} className="section-title">{title}</h3>
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
const slug = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');

/** Condiciones de un vistazo: a dónde llegamos, cuánto cuesta el envío y el mínimo. */
function HomeFacts({ data }: { data: MenuResponse }) {
  const d = data.delivery;
  const min = data.rules.minQtyPerItem > 1 ? `Mín. ${data.rules.minQtyPerItem} piezas por producto` : data.rules.minFresias > 1 ? `Pedido mínimo: ${data.rules.minFresias} productos` : null;
  return (
    <ul className="facts" aria-label="Condiciones de entrega">
      <li>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" /><circle cx="12" cy="9" r="2.5" /></svg>
        {d.deliveryEnabled ? 'Entregas a oficinas cercanas' : 'Por ahora solo para recoger'}
      </li>
      {d.deliveryEnabled && d.mode === 'radius' && (
        <li>Envío {money(d.radiusFee)}{d.freeShippingFrom != null && <> · <strong className="ok-text">gratis desde {money(d.freeShippingFrom)}</strong></>}</li>
      )}
      {min && <li>{min}</li>}
    </ul>
  );
}

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
    <section id="info" aria-labelledby="info-title" className="card flat stack" style={{ marginTop: 48 }}>
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

/** Fresigrama: deja el pedido marcado como regalo; los datos se escriben al final. */
function GiftCta() {
  const [on, setOn] = useState(() => loadStored(GIFT_KEY, emptyGift).on);
  const toggle = () => {
    const g = loadStored(GIFT_KEY, emptyGift);
    save(GIFT_KEY, { ...g, on: !on });
    setOn(!on);
  };
  return (
    <button type="button" className="gift-cta" onClick={toggle} aria-pressed={on}>
      <span style={{ fontSize: '1.6rem' }} aria-hidden="true">💌</span>
      <span className="grow">
        {on ? (
          <>
            <strong>Fresigrama activado.</strong> Elige su Frésia; al final escribes para quién es y su tarjeta.{' '}
            <span className="muted small">(Toca para quitarlo.)</span>
          </>
        ) : (
          <>
            <strong>Fresigrama:</strong> alguien en tu oficina merece un bombón. Mándale uno con tarjeta, incluso anónimo.
          </>
        )}
      </span>
    </button>
  );
}
