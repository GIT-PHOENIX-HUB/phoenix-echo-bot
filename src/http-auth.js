import { createHmac, timingSafeEqual } from 'crypto';

export function hasIndependentAuthentication(
  method,
  path,
  {
    teamsRouteEnabled = false,
    miniAppSubmitEnabled = false,
    miniAppSubmitAuthenticated = false
  } = {}
) {
  const normalizedMethod = String(method || '').toUpperCase();
  const normalizedPath = String(path || '');

  if (teamsRouteEnabled && normalizedMethod === 'POST' && normalizedPath === '/messages') {
    return true;
  }

  if (
    miniAppSubmitEnabled
    && normalizedPath === '/miniapp/submit'
  ) {
    if (normalizedMethod === 'OPTIONS') {
      return true;
    }
    if (normalizedMethod === 'POST' && miniAppSubmitAuthenticated) {
      return true;
    }
  }

  return false;
}

export function enabledMiniAppLaunchUrl(enabled, value) {
  return enabled ? String(value || '').trim() : '';
}

export function validateTelegramInitData(
  initData,
  botToken,
  { nowMs = Date.now(), maxAgeSeconds = 3600 } = {}
) {
  const raw = String(initData || '').trim();
  const token = String(botToken || '').trim();
  if (!raw || !token) return false;

  const params = new URLSearchParams(raw);
  const hash = String(params.get('hash') || '').toLowerCase();
  const authDate = Number(params.get('auth_date'));
  if (!/^[0-9a-f]{64}$/.test(hash) || !Number.isFinite(authDate)) {
    return false;
  }

  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  const ageSeconds = nowSeconds - authDate;
  if (
    !Number.isFinite(nowSeconds)
    || ageSeconds < -30
    || ageSeconds > maxAgeSeconds
  ) {
    return false;
  }

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => (
      left < right ? -1 : left > right ? 1 : 0
    ))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const calculated = createHmac('sha256', secret).update(dataCheckString).digest();
  const provided = Buffer.from(hash, 'hex');
  return provided.length === calculated.length && timingSafeEqual(provided, calculated);
}
