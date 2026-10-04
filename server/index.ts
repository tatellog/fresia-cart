import { loadConfig } from './env';
import { createApp } from './app';

const config = loadConfig();
const { app, ctx } = await createApp(config);
app.listen(config.port, () => {
  console.log(`Frésia Office en http://localhost:${config.port}`);
  console.log(ctx.provider.name === 'demo'
    ? '⚠️  Modo DEMOSTRACIÓN: pagos simulados, no se realizan cobros. Configura MP_ACCESS_TOKEN para activar Mercado Pago.'
    : 'Mercado Pago Checkout Pro activo.');
});
