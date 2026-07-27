import assert from 'node:assert/strict';
import test from 'node:test';

import { hasIndependentApiAuth } from '../src/gateway-auth-policy.js';

test('only exact POST Mini App submit bypasses the generic gateway token', () => {
  assert.equal(
    hasIndependentApiAuth({ method: 'POST', path: '/miniapp/submit' }),
    true
  );
  assert.equal(
    hasIndependentApiAuth({ method: 'GET', path: '/miniapp/submit' }),
    false
  );
  assert.equal(
    hasIndependentApiAuth({ method: 'POST', path: '/miniapp/chat' }),
    false
  );
  assert.equal(
    hasIndependentApiAuth({ method: 'POST', path: '/miniapp/submit/extra' }),
    false
  );
});

test('Teams bypass remains conditional on an active adapter', () => {
  assert.equal(
    hasIndependentApiAuth({ method: 'POST', path: '/messages', teamsEnabled: true }),
    true
  );
  assert.equal(
    hasIndependentApiAuth({ method: 'POST', path: '/messages', teamsEnabled: false }),
    false
  );
});
