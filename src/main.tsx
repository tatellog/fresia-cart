import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import './styles.css';
import { MenuProvider } from './lib/menu';
import { CartProvider } from './lib/cart';
import { Spinner } from './components/ui';
import MenuPage from './pages/MenuPage';
import ProductPage from './pages/ProductPage';
import CartPage from './pages/CartPage';
import DeliveryPage from './pages/DeliveryPage';
import SummaryPage from './pages/SummaryPage';
import OrderPage from './pages/OrderPage';

const DemoPayPage = lazy(() => import('./pages/DemoPayPage'));
const LegalPage = lazy(() => import('./pages/LegalPage'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function NotFound() {
  return (
    <main className="page stack" style={{ paddingTop: 48 }}>
      <h1>No encontramos esta página</h1>
      <a href="/" className="btn primary">Ir al menú</a>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ScrollTop />
      <MenuProvider>
        <CartProvider>
          <Suspense fallback={<main className="page" style={{ paddingTop: 40 }}><Spinner label="Cargando…" /></main>}>
            <Routes>
              <Route path="/" element={<MenuPage />} />
              <Route path="/producto/:id" element={<ProductPage />} />
              <Route path="/carrito" element={<CartPage />} />
              <Route path="/entrega" element={<DeliveryPage />} />
              <Route path="/resumen" element={<SummaryPage />} />
              <Route path="/pedido/:number" element={<OrderPage />} />
              <Route path="/demo-pago/:id" element={<DemoPayPage />} />
              <Route path="/legal/:slug" element={<LegalPage />} />
              <Route path="/admin/*" element={<AdminApp />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </CartProvider>
      </MenuProvider>
    </BrowserRouter>
  </StrictMode>,
);
