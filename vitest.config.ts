import { defineConfig } from 'vitest/config';

// Cada prueba levanta un Postgres embebido (PGlite); en paralelo puede tardar varios segundos.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
