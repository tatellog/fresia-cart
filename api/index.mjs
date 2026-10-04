// Función de Vercel. El servidor se empaqueta en build/server.mjs durante `npm run build`
// (Vercel no resuelve imports sin extensión entre archivos TypeScript).
export { default } from '../build/server.mjs';
