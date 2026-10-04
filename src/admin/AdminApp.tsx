import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api } from '../lib/api';
import { Spinner } from '../components/ui';
import Orders from './Orders';
import OrderDetail from './OrderDetail';
import Catalog from './Catalog';
import { BusinessSettings, DeliverySettings, LegalSettings, SystemSettings } from './Settings';
import './admin.css';

export default function AdminApp() {
  const [state, setState] = useState<{ admin: boolean; payments: string; onlinePaymentReady: boolean } | null>(null);
  const check = () =>
    api<{ admin: boolean; payments: string; onlinePaymentReady: boolean }>('/api/admin/me').then(setState, () => setState({ admin: false, payments: '', onlinePaymentReady: false }));
  useEffect(() => {
    void check();
    document.title = 'Panel · Frésia Office';
    // Panel instalable (pantalla de inicio) para recibir notificaciones, sobre todo en iPhone.
    const tags = [
      Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex' }),
      Object.assign(document.createElement('link'), { rel: 'manifest', href: '/admin.webmanifest' }),
      Object.assign(document.createElement('meta'), { name: 'apple-mobile-web-app-capable', content: 'yes' }),
      Object.assign(document.createElement('meta'), { name: 'apple-mobile-web-app-title', content: 'Frésia Panel' }),
    ];
    tags.forEach((t) => document.head.appendChild(t));
    return () => tags.forEach((t) => t.remove());
  }, []);

  if (!state) return <main className="page" style={{ paddingTop: 40 }}><Spinner label="Cargando…" /></main>;
  if (!state.admin) return <Login onDone={check} />;

  const logout = async () => {
    await api('/api/admin/logout', { body: {} });
    void check();
  };

  return (
    <div className="admin">
      {state.payments === 'demo' && state.onlinePaymentReady && (
        <div className="demo-banner">
          <strong>Entorno de prueba:</strong> el pago en línea es simulado.
        </div>
      )}
      <header className="admin-header">
        <div className="row between page wide" style={{ paddingBottom: 0 }}>
          <div className="row">
            <img src="/brand/fresia-puerta.svg" alt="" width={24} height={36} />
            <strong>Frésia Office · Panel</strong>
          </div>
          <button className="linkbtn" onClick={logout}>Salir</button>
        </div>
        <nav className="admin-nav page wide" aria-label="Secciones del panel">
          <NavLink to="/admin" end>Pedidos</NavLink>
          <NavLink to="/admin/menu">Menú</NavLink>
          <NavLink to="/admin/entrega">Entrega</NavLink>
          <NavLink to="/admin/negocio">Negocio</NavLink>
          <NavLink to="/admin/textos">Textos legales</NavLink>
          <NavLink to="/admin/sistema">QR y sistema</NavLink>
        </nav>
      </header>
      <main className="page wide" style={{ paddingTop: 24 }}>
        <Routes>
          <Route index element={<Orders />} />
          <Route path="pedidos/:id" element={<OrderDetail />} />
          <Route path="menu" element={<Catalog />} />
          <Route path="entrega" element={<DeliverySettings />} />
          <Route path="negocio" element={<BusinessSettings />} />
          <Route path="textos" element={<LegalSettings />} />
          <Route path="sistema" element={<SystemSettings />} />
        </Routes>
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="page stack-lg" style={{ paddingTop: 64, maxWidth: 420 }}>
      <img src="/brand/fresia-logo.svg" alt="Frésia" width={96} height={142} style={{ alignSelf: 'center' }} />
      <h1 style={{ textAlign: 'center' }}>Panel de pedidos</h1>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api('/api/admin/login', { body: { password } });
            onDone();
          } catch (err) {
            setError((err as Error).message);
          }
          setBusy(false);
        }}
      >
        <div className="field">
          <label htmlFor="pw">Contraseña</label>
          <input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy || !password}>
          {busy ? <Spinner label="Entrando…" /> : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
