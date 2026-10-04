# Frésia Office

Tienda web móvil para que oficinas de Del Valle Norte pidan fresas con crema desde el QR del volante:
**menú → carrito → entrega → pago → confirmación**, con panel para el negocio.

React + TypeScript (Vite) · servidor Node/Express · Postgres en **Supabase** · Mercado Pago Checkout Pro.

> ⚠️ **Estado actual: DEMOSTRACIÓN.** No se realizan cobros. Menú, precios, toppings, zonas, tarifas y tiempos
> son **de ejemplo** y aparecen marcados así en la tienda. Las fotos y el logo sí son de Frésia.

## Correr

```bash
npm install
cp .env.example .env   # y completa los valores
npm run dev            # tienda en http://localhost:5173 · API en :8787
npm test               # 22 pruebas del flujo (Postgres embebido)
npm run preview        # build de producción servido por Express en :8787
```

Panel: `/admin` (contraseña = `ADMIN_PASSWORD`).

## Qué funciona de verdad

| Área | Estado |
|---|---|
| Menú con foto, descripción, precio; tamaños, toppings con precio visible, cantidad y «¿Para quién es?» | ✅ |
| Carrito editable que sobrevive recargas (localStorage), seguir comprando | ✅ |
| Entrega a domicilio / recoger, validación de formulario, verificación de cobertura por CP y colonia | ✅ |
| Tarifa y tiempo estimado antes de pagar; direcciones que requieren cotización detienen el pago y guardan el pedido | ✅ |
| Precios, extras y envío **recalculados en el servidor**; los importes del navegador se ignoran | ✅ (probado) |
| Pedido creado y guardado **antes** del pago, con llave de idempotencia (sin duplicados por doble clic o reintentos) | ✅ (probado) |
| Estado del pago solo por consulta a la plataforma (notificación + consulta); volver a la URL de éxito no marca pagado | ✅ (probado) |
| Pagos pendientes, rechazados, cancelados; reintento sin duplicar pedido ni abrir un segundo cobro | ✅ (probado) |
| Pago, preparación y reembolso como estados separados; cancelar no implica reembolso | ✅ (probado) |
| Página de pedido con número, estado real, resumen, siguiente paso; WhatsApp opcional | ✅ |
| Panel protegido: pedidos (se actualiza cada 15 s, aviso sonoro), estados, cotizar envío, reembolsos, menú, toppings, disponibilidad, cobertura, datos del negocio, textos legales, QR | ✅ |
| QR permanente `/q/volante` → siempre abre el menú vigente (cuenta escaneos) | ✅ |
| Datos personales: el cliente ve su pedido solo con un token secreto; el esquema `office` no se expone por la API de Supabase y tiene RLS sin políticas | ✅ |

## Qué es simulado o falta configurar

1. **Pagos (simulados).** Sin `MP_ACCESS_TOKEN` el botón «Pagar» abre un *simulador* propio (aprobado / pendiente / rechazado / cancelar).
   La integración real de Checkout Pro ya está escrita (`server/payments/mercadopago.ts`) pero **no se ha probado contra Mercado Pago**. Para activarla:
   - Credenciales de **prueba** primero: `MP_ACCESS_TOKEN` (Panel de desarrolladores → Tus integraciones → Credenciales).
   - Webhooks → URL `https://TU-DOMINIO/api/webhooks/mercadopago`, evento **Pagos**; copia la clave secreta en `MP_WEBHOOK_SECRET`.
   - `PUBLIC_URL` debe ser tu dominio **https** (sin https Mercado Pago no puede notificar).
   - Haz una compra con usuarios de prueba, revisa *Panel → QR y sistema → Últimas notificaciones*, y luego cambia a credenciales de producción.
2. **Base de datos Supabase** (ver abajo). Sin `DATABASE_URL` el servidor usa un Postgres embebido local (PGlite) — solo para desarrollo.
3. **Contenido del negocio:** menú real, precios, toppings, zonas/CP, tarifas, tiempos, horario, dirección exacta, WhatsApp y correo.
   Todo se captura en el panel; al terminar, desmarca «ejemplo» en cada sección y desaparecen los avisos.
4. **Textos legales:** aviso de privacidad, entregas y cancelaciones son **borradores** con huecos `[Pendiente…]`. Revísalos con tu asesor y márcalos como aprobados en el panel.
5. **Aviso al negocio fuera del panel** (opcional): `NOTIFY_WEBHOOK_URL` recibe un POST por cada pedido pagado o por cotizar
   (para Make/Zapier/Slack/WhatsApp Business). Sin él, los pedidos llegan al panel igual, aunque el cliente cierre la página.
6. **Despliegue:** falta hospedar el servidor Node (Render, Railway, Fly, etc.) con las variables de `.env.example` y apuntar el dominio.
   Genera el QR desde *Panel → QR y sistema* **después** de fijar `PUBLIC_URL` definitiva.

## Supabase

Proyecto: `gdpggpebuioeiserpwyc`. El esquema está en `supabase/migrations/` (idempotente; el servidor también lo aplica al arrancar).

```bash
supabase login                                   # con la cuenta dueña del proyecto
supabase link --project-ref gdpggpebuioeiserpwyc
supabase db push                                 # crea el esquema office
```

Luego en `.env`:

```
DATABASE_URL=postgresql://postgres.gdpggpebuioeiserpwyc:[PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
```

- Usa el **Session pooler** (puerto 5432) si tu red u hosting no tiene IPv6; la *Direct connection* (`db.…supabase.co`) es solo IPv6.
  No uses el *Transaction pooler* (6543): el servidor usa transacciones y `pg_advisory_lock`.
- La **publishable key no se usa**: el navegador nunca habla con Supabase, todo pasa por el servidor. Así los pedidos y datos personales no quedan expuestos.
- La contraseña de la base de datos va solo en `.env` / variables del hosting, nunca en el código.

## Estructura

```
shared/     tipos, cálculo de precios y cobertura (los usan navegador y servidor)
server/     Express: pedidos, pagos (demo + Mercado Pago), panel, avisos
supabase/   migraciones SQL
src/        React: tienda (pages/) y panel (admin/)
tests/      pruebas de flujo: totales, cobertura, duplicados, pagos, panel, persistencia
```
