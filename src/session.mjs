/**
 * Who is looking at the panel. Hosted, the app's page is on the internet and
 * the panel of a streamer shows her chat's worst lines: it opens for her, and
 * for nobody else.
 *
 * There is no password to keep. A streamer proves who she is the way she
 * installs the app — by authorizing it on the Gamerfy — and comes back with a
 * cookie that says her id, until when, and a signature only this app can
 * make (HMAC-SHA256 with the store's secret). The cookie is `HttpOnly` (no
 * script reads it), `SameSite=Lax` (it does not travel on another site's
 * request) and `Secure` wherever the app is not on the computer's own address.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'moderador_sessao';
/** Remembers which authorization THIS browser asked for, between leaving for the Gamerfy and coming back. */
export const PENDING_COOKIE = 'moderador_pedido';
const SESSION_DAYS = 30;
export const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
export const PENDING_MS = 10 * 60 * 1000;

const sign = (secret, text) => createHmac('sha256', secret).update(text).digest('base64url');

export function sessionValue(secret, userId, now = Date.now()) {
  const body = `${userId}.${String(now + SESSION_MS)}`;
  return `${body}.${sign(secret, body)}`;
}

/** The streamer's id, from a cookie this app signed and that has not lapsed — or `null`. */
export function sessionUser(secret, value, now = Date.now()) {
  if (typeof value !== 'string') return null;
  const [userId, until, signature, ...rest] = value.split('.');
  if (rest.length > 0 || !userId || !until || !signature || !/^\d{1,20}$/.test(userId) || !/^\d{1,16}$/.test(until)) return null;
  const expected = Buffer.from(sign(secret, `${userId}.${until}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return Number(until) > now ? userId : null;
}

/** The `Cookie` header as a name → value map. */
export function cookiesOf(header) {
  const cookies = {};
  for (const part of String(header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) cookies[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return cookies;
}

/** A `Set-Cookie` line: `maxAgeMs` of 0 takes the cookie away. */
export function setCookie(name, value, { maxAgeMs, secure }) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(Math.floor(maxAgeMs / 1000))}${secure ? '; Secure' : ''}`;
}
