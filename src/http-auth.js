export function hasIndependentAuthentication(
  method,
  path,
  { teamsRouteEnabled = false, miniAppSubmitEnabled = false } = {}
) {
  const normalizedMethod = String(method || '').toUpperCase();
  const normalizedPath = String(path || '');

  if (teamsRouteEnabled && normalizedMethod === 'POST' && normalizedPath === '/messages') {
    return true;
  }

  if (
    miniAppSubmitEnabled
    && (normalizedMethod === 'POST' || normalizedMethod === 'OPTIONS')
    && normalizedPath === '/miniapp/submit'
  ) {
    // POST is authenticated by Telegram initData HMAC at the runtime. OPTIONS
    // is only the configured-origin CORS preflight for that same endpoint.
    return true;
  }

  return false;
}
