/**
 * Routes whose own protocol authentication is authoritative.
 *
 * The generic gateway token must not run first for these exact endpoints:
 * Bot Framework authenticates Teams messages, and the Python runtime validates
 * Telegram init data forwarded by the Mini App submit route.
 */
export function hasIndependentApiAuth({ method, path, teamsEnabled = false }) {
  const normalizedMethod = String(method || '').toUpperCase();
  const normalizedPath = String(path || '');
  if (normalizedMethod !== 'POST') return false;
  if (normalizedPath === '/miniapp/submit') return true;
  return teamsEnabled && normalizedPath === '/messages';
}
