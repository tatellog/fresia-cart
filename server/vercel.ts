import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadConfig } from './env';
import { createApp } from './app';

// Vercel: una instancia de Express por contenedor; se crea en la primera visita.
let appPromise: ReturnType<typeof createApp> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  appPromise ??= createApp(loadConfig());
  const { app } = await appPromise.catch((e) => {
    appPromise = null;
    throw e;
  });
  return app(req as never, res as never);
}
