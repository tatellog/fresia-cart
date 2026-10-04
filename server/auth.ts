import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Config } from './env';
import { HttpError } from './context';

const COOKIE = 'fo_admin';
const TTL_MS = 12 * 60 * 60 * 1000;

const sha = (s: string) => createHash('sha256').update(s).digest();

export function passwordMatches(cfg: Config, attempt: string) {
  return timingSafeEqual(sha(attempt), sha(cfg.adminPassword));
}

function sign(cfg: Config, value: string) {
  return createHmac('sha256', cfg.sessionSecret).update(value).digest('base64url');
}

export function setSession(cfg: Config, res: Response) {
  const exp = String(Date.now() + TTL_MS);
  res.cookie(COOKIE, `${exp}.${sign(cfg, exp)}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure: cfg.production,
    maxAge: TTL_MS,
    path: '/',
  });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE, { path: '/' });
}

function readCookie(req: Request, name: string) {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function isAdmin(cfg: Config, req: Request) {
  const raw = readCookie(req, COOKIE);
  if (!raw) return false;
  const [exp, sig] = raw.split('.');
  if (!exp || !sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(cfg, exp));
  return a.length === b.length && timingSafeEqual(a, b) && Number(exp) > Date.now();
}

export function requireAdmin(cfg: Config) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!isAdmin(cfg, req)) return next(new HttpError(401, 'Inicia sesión para continuar.'));
    // Defensa CSRF adicional a SameSite=strict: los cambios deben venir como JSON desde la app.
    if (req.method !== 'GET' && !req.is('application/json') && !req.is('image/*')) return next(new HttpError(415, 'Formato no soportado.'));
    next();
  };
}

/** Limitador simple en memoria (suficiente para una sola instancia). */
export function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = req.ip ?? 'x';
    const t = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < t) hits.set(key, { n: 1, reset: t + windowMs });
    else if (++h.n > max) return next(new HttpError(429, 'Demasiados intentos. Espera un momento.'));
    if (hits.size > 5000) hits.clear();
    next();
  };
}
