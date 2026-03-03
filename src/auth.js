/**
 * Phoenix Echo Auth Resolver
 *
 * OAuth-first auth strategy:
 * 1) ANTHROPIC_AUTH_TOKEN env
 * 2) ~/.phoenix-echo/auth-profiles.json anthropic profile token
 * 3) ANTHROPIC_API_KEY env (legacy fallback)
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return homedir();
  if (inputPath.startsWith('~/')) return resolve(homedir(), inputPath.slice(2));
  return inputPath;
}

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function pickAnthropicProfile(profiles, preferredProfile) {
  const candidates = [
    preferredProfile,
    'anthropic:default',
    'anthropic:manual',
    ...Object.keys(profiles).filter((k) => k.toLowerCase().startsWith('anthropic:'))
  ].filter(Boolean);

  for (const name of candidates) {
    const profile = profiles[name];
    if (!profile || typeof profile !== 'object') continue;
    const token = typeof profile.token === 'string' ? profile.token.trim() : '';
    if (token) {
      return { name, token };
    }
  }

  return null;
}

async function resolveAuthTokenFromProfiles(profilePath, preferredProfile) {
  if (!existsSync(profilePath)) {
    return null;
  }

  try {
    const raw = await readFile(profilePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const profiles = parsed?.profiles;
    if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
      return null;
    }

    const selected = pickAnthropicProfile(profiles, preferredProfile);
    if (!selected) {
      return null;
    }

    return {
      token: selected.token,
      source: `profile:${selected.name}`,
      profilePath
    };
  } catch {
    return null;
  }
}

export async function resolveAnthropicAuth() {
  const envAuthToken = (process.env.ANTHROPIC_AUTH_TOKEN || '').trim();
  if (envAuthToken) {
    return {
      authMode: 'oauth',
      authSource: 'env:ANTHROPIC_AUTH_TOKEN',
      clientOptions: {
        authToken: envAuthToken
      }
    };
  }

  const configuredPath = String(process.env.PHOENIX_AUTH_PROFILE_PATH || '').trim();
  const candidateProfilePaths = configuredPath
    ? [expandHome(configuredPath)]
    : [expandHome('~/.phoenix-echo/auth-profiles.json')];
  const preferredProfile = process.env.PHOENIX_ANTHROPIC_PROFILE || 'anthropic:default';

  for (const profilePath of candidateProfilePaths) {
    const profileAuth = await resolveAuthTokenFromProfiles(profilePath, preferredProfile);
    if (profileAuth?.token) {
      return {
        authMode: 'oauth',
        authSource: `${profileAuth.source}@${profileAuth.profilePath}`,
        clientOptions: {
          authToken: profileAuth.token
        }
      };
    }
  }

  const envApiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (envApiKey) {
    return {
      authMode: 'api_key',
      authSource: 'env:ANTHROPIC_API_KEY',
      clientOptions: {
        apiKey: envApiKey
      }
    };
  }

  throw new Error(
    'No Anthropic credentials found. Set ANTHROPIC_AUTH_TOKEN (preferred) or configure ~/.phoenix-echo/auth-profiles.json with an anthropic profile token.'
  );
}

export default { resolveAnthropicAuth };
