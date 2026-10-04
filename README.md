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

Proyecto `gdpggpebuioeiserpwyc` (ca-central-1). Migraciones en `supabase/migrations/`.

```bash
npm run db:setup   # aplica migraciones, crea/rota la contraseña del rol de la app y escribe DATABASE_URL en .env
npm run db:check   # 32 comprobaciones de seguridad contra la base real
npm run db:migrate # solo migraciones (tras cambiar el esquema)
```

Requiere en `.env` el usuario administrador en `DATABASE_ADMIN_URL` (o `SESSION_POOLER`), cadena *Session pooler*.

### Seguridad de la base de datos

| Medida | Cómo |
|---|---|
| Los datos no son accesibles desde internet con las claves públicas | Esquema `office` fuera de los esquemas expuestos; `anon`, `authenticated` y `service_role` sin ningún permiso; RLS activo y forzado en todas las tablas |
| El servidor opera con mínimo privilegio | Rol `fresia_office_app`: sin superusuario, sin `bypassrls`, solo el esquema `office`; no puede borrar pedidos ni pagos, ni alterar el historial, ni cambiar el esquema; sin acceso a `auth`, `vault` ni `storage`; `statement_timeout` 15 s |
| Conexión cifrada y verificada | TLS contra la CA oficial de Supabase (`server/certs/supabase-prod-ca-2021.crt`, válida hasta 2031) — nunca `rejectUnauthorized: false` |
| Tablas futuras seguras por defecto | `alter default privileges` en `office` revoca todo a los roles de la API |
| El servidor no arranca en producción con un usuario administrador | Comprobación al iniciar (`rolbypassrls`/`rolsuper`) |
| Verificable | `npm run db:check` y `tests/permissions.test.ts` (toda la suite corre con el rol limitado) |

Pendiente en el dashboard de Supabase (requiere tu cuenta):
1. **Database → Settings → SSL Configuration → Enforce SSL**: rechaza conexiones sin cifrar.
2. **Database → Settings → Network Restrictions**: al desplegar, permite solo la IP del hosting (y la tuya para `db:setup`).
3. **Project Settings → Data API**: desactívala; la app no la usa.
4. **Backups**: el plan gratuito no incluye respaldos descargables ni restauración a un punto en el tiempo; considera el plan Pro antes de operar con pedidos reales.

## Estructura

```
shared/     tipos, cálculo de precios y cobertura (los usan navegador y servidor)
server/     Express: pedidos, pagos (demo + Mercado Pago), panel, avisos
supabase/   migraciones SQL
src/        React: tienda (pages/) y panel (admin/)
tests/      pruebas de flujo: totales, cobertura, duplicados, pagos, panel, persistencia
```
