import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryKvAdapter } from '../server/kvAdapter';
import { onRequestGet as stateGet, onRequestPost as statePost } from '../functions/api/agentic-transaction/state';
import { onRequestPost as exchangePost } from '../functions/api/agentic-transaction/exchange';
import { onRequestPost as executePost } from '../functions/api/agentic-transaction/execute';
import { onRequestPost as approvePost } from '../functions/api/agentic-transaction/approve';
import type { AgenticTransactionEnv } from '../functions/api/agentic-transaction/_shared';

function makeEnv(kv = new MemoryKvAdapter({ labSlug: 'agentic-transaction' })): AgenticTransactionEnv {
  return {
    STATE_KV: kv,
    ENVIRONMENT: 'test',
    SN_AGENT_CALLBACK_TOKEN: 'test-callback-secret'
  };
}

function makePost(path: string, body: unknown, sessionId: string, extraHeaders: Record<string, string> = {}): Request {
  return new Request(`https://lab.0trust.dev${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': sessionId,
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });
}

describe('Layer 2: Lab 2 API Routes against MemoryKvAdapter', () => {
  it('supports multi-order pending queue concurrency (escalate A & B -> approve A -> deny B)', async () => {
    const env = makeEnv();
    const sid = 'multi-order-session';

    // Escalate Order A (ORD-1042)
    const escARes = await approvePost({
      request: makePost('/api/agentic-transaction/approve', { action: 'bedrock_advisory', order_id: 'ORD-1042' }, sid),
      env
    });
    assert.equal(escARes.status, 200);
    const escAData = (await escARes.json()) as {
      hitl_callback_token: string;
      updated_record: { order_id: string; current_status: string };
    };
    assert.equal(escAData.updated_record.current_status, 'PROCESSING');

    // Escalate Order B (ORD-1043)
    const escBRes = await approvePost({
      request: makePost('/api/agentic-transaction/approve', { action: 'bedrock_advisory', order_id: 'ORD-1043' }, sid),
      env
    });
    assert.equal(escBRes.status, 200);
    const escBData = (await escBRes.json()) as {
      hitl_callback_token: string;
      updated_record: { order_id: string; current_status: string };
    };
    assert.equal(escBData.updated_record.current_status, 'PROCESSING');

    // Approve Order A -> ORD-1042 becomes RELEASED
    const appARes = await approvePost({
      request: makePost(
        '/api/agentic-transaction/approve',
        { action: 'hitl_callback', order_id: 'ORD-1042', decision: 'APPROVED' },
        sid,
        { 'X-Agent-Callback-Token': escBData.hitl_callback_token }
      ),
      env
    });
    assert.equal(appARes.status, 200);
    const appAData = (await appARes.json()) as {
      status: string;
      updated_record: { order_id: string; current_status: string };
    };
    assert.equal(appAData.status, 'APPROVED_RELEASED');
    assert.equal(appAData.updated_record.current_status, 'RELEASED');

    // Deny Order B -> ORD-1043 returns to BLOCKED
    const denyBRes = await approvePost({
      request: makePost(
        '/api/agentic-transaction/approve',
        { action: 'hitl_callback', order_id: 'ORD-1043', decision: 'DENIED', justification: 'Unverified vendor' },
        sid,
        { 'X-Agent-Callback-Token': escBData.hitl_callback_token }
      ),
      env
    });
    assert.equal(denyBRes.status, 200);
    const denyBData = (await denyBRes.json()) as {
      updated_record: { order_id: string; current_status: string };
    };
    assert.equal(denyBData.updated_record.current_status, 'BLOCKED');
  });

  it('enforces autonomous spending threshold (LOW_VALUE_AUTO auto-clears vs COMPLIANT_AUDIT escalates)', async () => {
    const env = makeEnv();
    const sid = 'threshold-session';

    const autoRes = await executePost({
      request: makePost('/api/agentic-transaction/execute', { scenario: 'LOW_VALUE_AUTO', persona: 'erp-operator' }, sid),
      env
    });
    assert.equal(autoRes.status, 200);
    const autoData = (await autoRes.json()) as { status: string; hitl_status: string };
    assert.equal(autoData.status, 'ALLOWED');
    assert.equal(autoData.hitl_status, 'AUTO_APPROVED');

    const escRes = await executePost({
      request: makePost(
        '/api/agentic-transaction/execute',
        { scenario: 'COMPLIANT_AUDIT', order_id: 'ORD-1042', persona: 'erp-operator' },
        sid
      ),
      env
    });
    assert.equal(escRes.status, 202);
    const escData = (await escRes.json()) as { status: string; hitl_status: string };
    assert.equal(escData.status, 'ESCALATED_HITL');
    assert.equal(escData.hitl_status, 'PENDING_HUMAN_APPROVAL');
  });

  it('degrades safely on bedrock_advisory timeout simulation and handles state GET/POST', async () => {
    const env = makeEnv();
    const sid = 'timeout-session';

    const timeoutRes = await approvePost({
      request: makePost(
        '/api/agentic-transaction/approve',
        { action: 'bedrock_advisory', order_id: 'ORD-1042', simulate_timeout: true },
        sid
      ),
      env
    });
    assert.ok([200, 504].includes(timeoutRes.status));
    const timeoutData = (await timeoutRes.json()) as { status?: string; error?: string };
    assert.ok(Boolean(timeoutData.status || timeoutData.error));

    // state GET & POST
    const postStateRes = await statePost({
      request: new Request(`https://lab.0trust.dev/api/agentic-transaction/state?session=${sid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marker: 'ok' })
      }),
      env
    });
    assert.equal(postStateRes.status, 200);

    const getStateRes = await stateGet({
      request: new Request(`https://lab.0trust.dev/api/agentic-transaction/state?session=${sid}`, { method: 'GET' }),
      env
    });
    assert.equal(getStateRes.status, 200);
    const getStateData = (await getStateRes.json()) as { state: { marker: string } };
    assert.equal(getStateData.state.marker, 'ok');
  });

  it('isolates state between session-A and session-B', async () => {
    const env = makeEnv();

    await exchangePost({
      request: makePost('/api/agentic-transaction/exchange', { persona: 'support-agent', attack_mode: 'NONE' }, 'session-A'),
      env
    });
    await approvePost({
      request: makePost('/api/agentic-transaction/approve', { action: 'bedrock_advisory', order_id: 'ORD-1042' }, 'session-A'),
      env
    });

    // session-B should still have default BLOCKED ORD-1042
    const bRes = await executePost({
      request: makePost('/api/agentic-transaction/execute', { scenario: 'COMPLIANT_AUDIT', order_id: 'ORD-1042' }, 'session-B'),
      env
    });
    assert.equal(bRes.status, 202);
    const bData = (await bRes.json()) as { session_id: string };
    assert.equal(bData.session_id, 'session-B');
  });
});
