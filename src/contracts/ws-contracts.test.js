import { strict as assert } from 'assert';
import {
  normalizeClientMessage, createResponseEvent, createErrorEvent,
  createTypingEvent, createHeartbeatEvent, createSessionEvent,
  CLIENT_MESSAGE_TYPES, SERVER_EVENT_TYPES
} from './ws-contracts.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

console.log('WS Contract Tests\n');

console.log('Handshake:');
test('auth message shape', () => {
  const n = normalizeClientMessage({ type: 'auth', token: 'x' });
  assert.equal(n.type, 'auth'); assert.equal(n.token, 'x');
});

console.log('\nMessage Send:');
test('legacy message→chat', () => {
  const n = normalizeClientMessage({ type: 'message', content: 'hi' });
  assert.equal(n.type, 'chat'); assert.equal(n.content, 'hi');
});
test('canonical chat passthrough', () => {
  const n = normalizeClientMessage({ type: 'chat', content: 'hi' });
  assert.equal(n.type, 'chat'); assert.equal(n.content, 'hi');
});
test('legacy text field', () => {
  const n = normalizeClientMessage({ type: 'message', text: 'hi' });
  assert.equal(n.content, 'hi');
});
test('null input', () => {
  assert.equal(normalizeClientMessage(null).type, 'unknown');
});

console.log('\nServer Events:');
test('response event', () => {
  const e = createResponseEvent('Hello', 'main', 'r1');
  assert.equal(e.type, 'response'); assert.equal(e.content, 'Hello');
});
test('error event with code', () => {
  const e = createErrorEvent('fail', 'ERR');
  assert.equal(e.type, 'error'); assert.equal(e.code, 'ERR');
});
test('error event without code', () => {
  const e = createErrorEvent('fail');
  assert.equal(e.code, undefined);
});
test('typing event', () => {
  assert.equal(createTypingEvent(true).status, true);
});

console.log('\nHeartbeat:');
test('heartbeat has ts', () => {
  const e = createHeartbeatEvent();
  assert.equal(e.type, 'heartbeat'); assert.ok(e.ts);
});

console.log('\nSession:');
test('session event', () => {
  const e = createSessionEvent('main', 42);
  assert.equal(e.sessionId, 'main'); assert.equal(e.messageCount, 42);
});
test('session with checkpoint', () => {
  const e = createSessionEvent('t', 5, { idx: 3 });
  assert.deepEqual(e.checkpoint, { idx: 3 });
});

console.log('\nConstants:');
test('both message types', () => {
  assert.equal(CLIENT_MESSAGE_TYPES.MESSAGE, 'message');
  assert.equal(CLIENT_MESSAGE_TYPES.CHAT, 'chat');
});
test('server event types', () => {
  assert.equal(SERVER_EVENT_TYPES.RESPONSE, 'response');
  assert.equal(SERVER_EVENT_TYPES.HEARTBEAT, 'heartbeat');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
