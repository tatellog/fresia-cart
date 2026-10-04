# Frésia Office

Tienda web móvil para que oficinas de Del Valle Norte pidan fresas con crema desde el QR del volante:
**menú → carrito → entrega → pago → confirmación**, con panel para el negocio.

React + TypeScript (Vite) · servidor Node/Express · Postgres en **Supabase** · Mercado Pago Checkout Pro.

> ⚠️ **Estado actual: DEMOSTRACIÓN.** No se realizan cobros. El menú y sus precios son los definidos por Frésia
> para oficinas; las reglas de toppings vienen de Frésia OS (punto de venta). La tarifa y el tiempo de entrega siguen **de ejemplo** y aparecen marcados así.

### Cobertura: 300 m alrededor de Frésia

Frésia: Av. Insurgentes Sur 612, local C, esq. Valle de Arizpe, Del Valle Norte (≈ 19.39725, −99.1712; ajustable en el panel).
El cliente toca **«Usar mi ubicación»** desde el lugar de entrega y el servidor mide la distancia:
- dentro aun con el margen de error del GPS → se acepta con tarifa y tiempo;
- fuera aun con el margen → no se acepta (se ofrece recoger);
- en el límite, GPS impreciso (> 80 m) o sin permiso de ubicación → se guarda el pedido y se confirma por WhatsApp.

Por qué GPS y no la dirección escrita: los geocodificadores gratuitos solo ubican la calle en esta zona (error de cientos de metros).
Si se agrega una clave de Google Maps, se puede validar también la dirección. La ubicación requiere HTTPS (o `localhost`).
El repartidor ve en el panel el punto GPS del cliente para compararlo con la dirección.

### Panel: avanzar pedidos y seguimiento en vivo

- Cada pedido muestra **un botón con la siguiente acción** (también en la lista): «Empezar a preparar» → «Salir a entregar»
  (o «Listo para recoger») → «Entregado» / «Entregado y cobrado $X». Los pasos de arriba permiten corregir un estado.
- **Seguimiento en vivo:** al tocar «Salir a entregar» en el celular de quien reparte, ese celular comparte su ubicación cada
  ~8 s mientras la página esté abierta (límite de la web: sin app nativa no hay rastreo en segundo plano). El cliente ve en su
  página un mapa (OpenStreetMap) con Frésia, el repartidor y su destino, y la distancia que falta. Al entregar se borra la ubicación.

### Datos del negocio

- **Horario:** lunes a jueves 12:00–20:30 · viernes y sábado 12:00–20:00 · domingo cerrado.
- **WhatsApp para confirmar pedidos:** +52 55 8233 0124 (temporal; se cambia en *Panel → Negocio*).

### Pago

El cliente elige en el resumen:
- **Pagar en línea** con Mercado Pago Checkout Pro: tarjeta de crédito/débito, saldo Mercado Pago u OXXO.
  (Apple Pay y Google Pay no aparecen documentados para Checkout Pro en México; no se anuncian.)
- **Pagar al recibir / al recoger:** el pedido entra directo a la cocina; en el panel se marca «cobrado» al entregar.

### Aviso a tu WhatsApp

Cada pedido pagado en línea (al confirmarse el pago), cada pedido «pagar al recibir» y cada pedido que necesita
cotización de envío se envía al WhatsApp del negocio (o a `WHATSAPP_NOTIFY_TO`) con productos, toppings, para quién,
entrega, cliente y enlace al panel. El servidor lo envía aunque el cliente cierre la página.

Configura **una** opción en `.env`:
- **Meta WhatsApp Cloud API (oficial):** `WHATSAPP_PROVIDER=meta`, `META_WHATSAPP_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`,
  `META_WHATSAPP_TEMPLATE=pedido_fresia`. Si el número que recibe le escribió al número del negocio en las últimas 24 h, llega el
  mensaje completo tipo comanda; si no, llega la plantilla (Meta no permite saltos de línea en sus variables, así que los productos
  van en un renglón y el botón abre el detalle).

**Plantilla `pedido_fresia`** (Meta → Plantillas de mensajes → Crear): categoría **Utilidad**, idioma **Español (MEX)**.

Cuerpo:
```
🍓 *Nuevo pedido {{1}}*

💵 {{2}}
🛵 {{3}}
👤 {{4}}

🧾 *Productos:* {{5}}

📝 {{6}}

Toca «Ver pedido» para el detalle completo.
```
Botón: **Visitar sitio web** · texto «Ver pedido» · URL **dinámica** `https://fresia-office.vercel.app/admin/pedidos/{{1}}`.
Si se crea sin botón, pon `META_WHATSAPP_TEMPLATE_BUTTON=0`.

- **CallMeBot (rápida, gratuita):** `WHATSAPP_PROVIDER=callmebot`, `CALLMEBOT_APIKEY`. Se activa desde tu WhatsApp siguiendo
  https://www.callmebot.com/blog/free-api-whatsapp-messages/. Es un servicio de terceros: el texto del aviso pasa por sus servidores.

Sin configurar, el pedido igual llega al panel y su historial dice «WhatsApp no configurado».

### Reglas del menú

- **Mínimo 3 piezas por producto:** cada producto suelto se agrega desde 3 (el selector no baja de ahí); los combos desde 1.
- Sin mínimo de Frésias por pedido (se puede activar en *Panel → Menú → Reglas*).
- **Menú:** Frésia Clásica, Uvas y Mix Frésia ($100/$120/$140), Frésia Balance ($110/$130/$150), Frésia Choco Crema ($120/$140/$160),
  Chocolate sin crema (solo chico, $140), Pan tradicional ($45), Pan relleno Frésia ($100), Waffle Frésia ($104).
- **Toppings:** 2 incluidos (1 en Frésia en Nogada y pan relleno), cada adicional $18; los premium (+$25) no gastan incluidos.
  En el Waffle el Turín y las mermeladas cuentan como incluidos.
- **Combos** (precio = suma de sus productos; los toppings extra de cada pieza se cobran aparte):
  - *Pausa Frésia* $640: 3 Clásicas medianas + 2 Chocolate sin crema chicos → cuenta 5 Frésias.
  - *Dulce Tradición* $500: 5 panes rellenos Frésia → cuenta 0 Frésias.
  - *Cumple con Frésia* $564: 1 Clásica mediana + 1 Chocolate sin crema chico + 2 panes rellenos + 1 waffle → cuenta 2 Frésias.
- **Frèsia Brûlée:** no se vende en línea (solo en el local).
- **Combos:** se crean en *Panel → Menú → Combos*: precio fijo y partes («3 Frésias chicas a elegir entre…»); el cliente arma cada pieza
  con sus toppings. `npm run db:catalog` recarga el catálogo base de `server/seed.ts` (reemplaza el menú).

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
3. **Contenido del negocio:** combos, tarifa y tiempo de entrega dentro de los 270 m, horario, WhatsApp y correo.
   Todo se captura en el panel; al terminar, desmarca «ejemplo» en cada sección y desaparecen los avisos.
4. **Textos legales:** aviso de privacidad, entregas y cancelaciones son **borradores** con huecos `[Pendiente…]`. Revísalos con tu asesor y márcalos como aprobados en el panel.
5. **Aviso al negocio fuera del panel** (opcional): `NOTIFY_WEBHOOK_URL` recibe un POST por cada pedido pagado o por cotizar
   (para Make/Zapier/Slack/WhatsApp Business). Sin él, los pedidos llegan al panel igual, aunque el cliente cierre la página.
6. **Despliegue:** falta hospedar el servidor Node (Render, Railway, Fly, etc.) con las variables de `.env.example` y apuntar el dominio.
   Genera el QR desde *Panel → QR y sistema* **después** de fijar `PUBLIC_URL` definitiva.

## Producción (Vercel)

- Tienda: **https://fresia-office.vercel.app** · Panel: **https://fresia-office.vercel.app/admin** · QR: `/q/volante`
- Proyecto `tatellogs-projects/fresia-office`. Desplegar: `vercel deploy --prod`.
- Variables (Vercel → Settings → Environment Variables): `DATABASE_URL` (rol limitado), `ADMIN_PASSWORD`, `SESSION_SECRET`,
  `WHATSAPP_PROVIDER` y `META_WHATSAPP_*`. La contraseña del panel de producción está en tu `.env` local como `ADMIN_PASSWORD_PRODUCCION`.
- El servidor se empaqueta en `build/server.mjs` (`npm run build:server`) y corre como función (`api/index.mjs`); los estáticos van por la CDN.

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
tests/      pruebas: totales, mínimo, toppings, combos, cobertura, duplicados, pagos, panel, permisos, persistencia
```
