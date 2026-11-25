import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCloudRunApp, verifyRouterSecret } from '../server/app';
import {
  buildKvDocId,
  FirestoreKvAdapter,
  MemoryKvAdapter,
  type FirestoreCollectionLike,
  type FirestoreKvDoc
} from '../server/kvAdapter';
import { resolvePublicOrigin } from '../server/origin';

const TEST_ROUTER_SECRET = 'test-router-secret-value-0123456789';
const TEST_CALLBACK_SECRET = 'test-sn-agent-callback-secret-987654';

function createMockFirestoreCollection(): {
  collection: FirestoreCollectionLike;
  store: Map<string, FirestoreKvDoc>;
} {
  const store = new Map<string, FirestoreKvDoc>();
  const collection: FirestoreCollectionLike = {
    doc(id: string) {
      return {
        async get() {
          const data = store.get(id);
          return {
            exists: Boolean(data),
            data: () => data
          };
        },
        async set(data: FirestoreKvDoc) {
          store.set(id, data);
        },
        async delete() {
          store.delete(id);
        }
      };
    }
  };
  return { collection, store };
}

describe('Lab 2 Cloud Run Adapter — Security Invariants & API Flow', () => {
  it('blocks direct *.run.app /api/* requests without or with invalid X-Lab-Router-Secret (fail-closed 403)', async () => {
    const app = createCloudRunApp({
      env: {
        ENVIRONMENT: 'production',
        LAB_SLUG: 'agentic-transaction',
        LAB_ROUTER_SECRET: TEST_ROUTER_SECRET,
        SN_AGENT_CALLBACK_TOKEN: TEST_CALLBACK_SECRET
      },
      kv: new MemoryKvAdapter({ labSlug: 'agentic-transaction' })
    });

    // Missing header
    const resMissing = await app.request(
      'https://0trust-lab-agentic-transaction-abc.run.app/api/agentic-transaction/state?session=s1'
    );
    assert.equal(resMissing.status, 403);
    assert.deepEqual(await resMissing.json(), { error: 'FORBIDDEN_DIRECT_ORIGIN' });

    // Wrong secret (same length & different length)
    const resWrongSameLen = await app.request(
      'https://0trust-lab-agentic-transaction-abc.run.app/api/agentic-transaction/state?session=s1',
      {
        headers: { 'x-lab-router-secret': 'wrong-router-secret-value-987654321' }
      }
    );
    assert.equal(resWrongSameLen.status, 403);
    assert.deepEqual(await resWrongSameLen.json(), { error: 'FORBIDDEN_DIRECT_ORIGIN' });

    const resWrongDiffLen = await app.request(
      'https://0trust-lab-agentic-transaction-abc.run.app/api/agentic-transaction/state?session=s1',
      {
        headers: { 'x-lab-router-secret': 'short' }
      }
    );
    assert.equal(resWrongDiffLen.status, 403);

    // Fail-closed when LAB_ROUTER_SECRET is unset in production
    const appUnconfigured = createCloudRunApp({
      env: {
        ENVIRONMENT: 'production',
        LAB_SLUG: 'agentic-transaction'
      },
      kv: new MemoryKvAdapter({ labSlug: 'agentic-transaction' })
    });
    const resUnconfigured = await appUnconfigured.request(
      'https://0trust-lab-agentic-transaction-abc.run.app/api/agentic-transaction/state?session=s1',
      {
        headers: { 'x-lab-router-secret': TEST_ROUTER_SECRET }
      }
    );
    assert.equal(resUnconfigured.status, 403);
    assert.deepEqual(await resUnconfigured.json(), { error: 'FORBIDDEN_DIRECT_ORIGIN' });

    // Valid secret succeeds
    const resValid = await app.request(
      'https://0trust-lab-agentic-transaction-abc.run.app/api/agentic-transaction/state?session=s1',
      {
        headers: { 'x-lab-router-secret': TEST_ROUTER_SECRET }
      }
    );
    assert.equal(resValid.status, 200);
    assert.equal(verifyRouterSecret(TEST_ROUTER_SECRET, TEST_ROUTER_SECRET), true);
  });

  it('serves GET /healthz without X-Lab-Router-Secret (Cloud Run probe)', async () => {
    const app = createCloudRunApp({
      env: {
        ENVIRONMENT: 'production',
        LAB_SLUG: 'agentic-transaction',
        LAB_ROUTER_SECRET: TEST_ROUTER_SECRET
      },
      kv: new MemoryKvAdapter({ labSlug: 'agentic-transaction' })
    });

    const res = await app.request('https://0trust-lab-agentic-transaction-abc.run.app/healthz');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, lab: 'agentic-transaction' });
  });

  it('synchronously returns null on expired TTL docs in FirestoreKvAdapter & MemoryKvAdapter', async () => {
    let nowMs = 1_700_000_000_000;
    const { collection, store } = createMockFirestoreCollection();
    const firestoreKv = new FirestoreKvAdapter({
      labSlug: 'agentic-transaction',
      collectionRef: collection,
      nowFn: () => nowMs
    });

    await firestoreKv.put('lab2:cap:2026-11-24', '42', { expirationTtl: 86400 });
    const expectedDocId = buildKvDocId('agentic-transaction', 'lab2:cap:2026-11-24');
    assert.equal(expectedDocId, 'agentic-transaction:lab2%3Acap%3A2026-11-24');

    const storedDoc = store.get(expectedDocId);
    assert.ok(storedDoc);
    assert.equal(storedDoc.labSlug, 'agentic-transaction');
    assert.equal(storedDoc.value, '42');
    assert.equal(storedDoc.expireAt?.toMillis(), nowMs + 86_400_000);

    // Before expiry
    assert.equal(await firestoreKv.get('lab2:cap:2026-11-24'), '42');

    // Advance clock past TTL without deleting the doc from Firestore
    nowMs += 86_400_000;
    assert.equal(store.has(expectedDocId), true);
    assert.equal(await firestoreKv.get('lab2:cap:2026-11-24'), null);

    // MemoryKvAdapter parity
    let memNow = 1_700_000_000_000;
    const memKv = new MemoryKvAdapter({ labSlug: 'agentic-transaction', nowFn: () => memNow });
    await memKv.put('lab2:agentic:s1', '{"ok":true}', { expirationTtl: 15 });
    assert.equal(await memKv.get('lab2:agentic:s1'), '{"ok":true}');
    memNow += 15_000;
    assert.equal(await memKv.get('lab2:agentic:s1'), null);
  });

  it('rejects forged X-Forwarded-Host headers and allows lab.0trust.dev and localhost:5175', () => {
    const forgedReq = new Request(
      'https://0trust-lab-agentic-transaction-abc.run.app/api/agentic-transaction/state',
      {
        headers: {
          'x-forwarded-host': 'evil.com',
          'x-forwarded-proto': 'https'
        }
      }
    );
    assert.equal(
      resolvePublicOrigin(forgedReq),
      'https://0trust-lab-agentic-transaction-abc.run.app'
    );

    const localReq = new Request('http://127.0.0.1:8080/api/agentic-transaction/state', {
      headers: {
        'x-forwarded-host': 'localhost:5175',
        'x-forwarded-proto': 'http'
      }
    });
    assert.equal(resolvePublicOrigin(localReq), 'http://localhost:5175');
  });

  it('redacts JWT signatures in _telemetry and never leaks X-Lab-Router-Secret, OTLP_AUTH_HEADER, or SN_AGENT_CALLBACK_TOKEN', async () => {
    const otlpAuthSecret = 'Bearer otlp-super-secret-header-token';
    const capturedOtlpBodies: string[] = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedOtlpBodies.push(String(init?.body || ''));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      const app = createCloudRunApp({
        env: {
          ENVIRONMENT: 'production',
          LAB_SLUG: 'agentic-transaction',
          LAB_ROUTER_SECRET: TEST_ROUTER_SECRET,
          SN_AGENT_CALLBACK_TOKEN: TEST_CALLBACK_SECRET,
          OTLP_ENDPOINT: 'https://otlp.example.com',
          OTLP_AUTH_HEADER: otlpAuthSecret
        },
        kv: new MemoryKvAdapter({ labSlug: 'agentic-transaction' })
      });

      const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzYXJhaCJ9.SuperSecretSignatureXYZ123';
      const res = await app.request(
        'https://0trust-lab-agentic-transaction-abc.run.app/api/agentic-transaction/approve',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-lab-router-secret': TEST_ROUTER_SECRET,
            'x-agent-callback-token': TEST_CALLBACK_SECRET,
            authorization: `Bearer ${fakeJwt}`,
            traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
          },
          body: JSON.stringify({
            sessionId: 'redaction-check',
            action: 'hitl_callback',
            order_id: 'ORD-1042',
            decision: 'APPROVED'
          })
        }
      );

      assert.equal(res.status, 200);
      assert.ok(res.headers.get('traceparent')?.startsWith('00-4bf92f3577b34da6a3ce929d0e0e4736-'));
      assert.ok(res.headers.get('X-Edge-Latency-Ms'));

      const bodyText = await res.text();
      assert.ok(!bodyText.includes('SuperSecretSignatureXYZ123'), 'JWT signature must be redacted');
      assert.ok(!bodyText.includes(TEST_ROUTER_SECRET), 'Router secret must never appear in response');
      assert.ok(!bodyText.includes(otlpAuthSecret), 'OTLP auth header must never appear in response');
      assert.ok(
        !bodyText.includes(TEST_CALLBACK_SECRET),
        'SN_AGENT_CALLBACK_TOKEN must never appear in response'
      );

      const parsed = JSON.parse(bodyText) as {
        _telemetry: { redacted_auth_header: string; redaction_applied: boolean };
      };
      assert.equal(parsed._telemetry.redaction_applied, true);
      assert.equal(
        parsed._telemetry.redacted_auth_header,
        'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzYXJhaCJ9.***REDACTED***'
      );

      await new Promise((r) => setTimeout(r, 10));
      assert.equal(capturedOtlpBodies.length, 2);
      for (const body of capturedOtlpBodies) {
        assert.ok(body.includes('zerotrust-lab-agentic-transaction'));
        assert.ok(!body.includes(TEST_ROUTER_SECRET));
        assert.ok(!body.includes('SuperSecretSignatureXYZ123'));
        assert.ok(!body.includes(otlpAuthSecret));
        assert.ok(!body.includes(TEST_CALLBACK_SECRET));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('executes full Lab 2 happy-path flow (state → exchange → execute → approve bedrock_advisory → HITL callback)', async () => {
    const kv = new MemoryKvAdapter({ labSlug: 'agentic-transaction' });
    const app = createCloudRunApp({
      env: {
        ENVIRONMENT: 'development',
        LAB_SLUG: 'agentic-transaction',
        SN_AGENT_CALLBACK_TOKEN: TEST_CALLBACK_SECRET
      },
      kv
    });

    const sessionId = 'lab2-e2e-session';

    // 1. State POST & GET round-trip
    const statePostRes = await app.request(
      `http://127.0.0.1:8080/api/agentic-transaction/state?session=${sessionId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 1, persona: 'erp-operator' })
      }
    );
    assert.equal(statePostRes.status, 200);
    const stateGetRes = await app.request(
      `http://127.0.0.1:8080/api/agentic-transaction/state?session=${sessionId}`
    );
    assert.equal(stateGetRes.status, 200);
    const stateGetData = (await stateGetRes.json()) as { state: { step: number } };
    assert.equal(stateGetData.state.step, 1);

    // 2. Stage 1: Token Exchange (Auth0 strip → Okta ID-JAG 900s → GCP→AWS STS)
    const exRes = await app.request('http://127.0.0.1:8080/api/agentic-transaction/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
      body: JSON.stringify({ persona: 'erp-operator', order_id: 'ORD-1042', attack_mode: 'NONE' })
    });
    assert.equal(exRes.status, 200);
    const exData = (await exRes.json()) as {
      status: string;
      stripped_at_frontdoor: boolean;
      expires_in: number;
    };
    assert.equal(exData.status, 'VALIDATED');
    assert.equal(exData.stripped_at_frontdoor, true);
    assert.equal(exData.expires_in, 900);

    // 3. Stage 2: MCP Policy Proxy execution (>$200 escalates to HITL)
    const execRes = await app.request('http://127.0.0.1:8080/api/agentic-transaction/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
      body: JSON.stringify({
        persona: 'erp-operator',
        order_id: 'ORD-1042',
        scenario: 'COMPLIANT_AUDIT'
      })
    });
    assert.equal(execRes.status, 202);
    const execData = (await execRes.json()) as { status: string; hitl_status: string };
    assert.equal(execData.status, 'ESCALATED_HITL');
    assert.equal(execData.hitl_status, 'PENDING_HUMAN_APPROVAL');

    // 4. Stage 3A: Bedrock SigV4 advisory (sets PROCESSING)
    const advisoryRes = await app.request('http://127.0.0.1:8080/api/agentic-transaction/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
      body: JSON.stringify({ action: 'bedrock_advisory', order_id: 'ORD-1042' })
    });
    assert.equal(advisoryRes.status, 200);
    const advisoryData = (await advisoryRes.json()) as {
      status: string;
      updated_record: { current_status: string };
    };
    assert.equal(advisoryData.status, 'ADVISORY_APPENDED_AWAITING_HITL');
    assert.equal(advisoryData.updated_record.current_status, 'PROCESSING');

    // 5. Stage 3B: HITL callback rejects invalid token (401) and accepts valid SN_AGENT_CALLBACK_TOKEN (200)
    const invalidCbRes = await app.request('http://127.0.0.1:8080/api/agentic-transaction/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId,
        'X-Agent-Callback-Token': 'forged-token'
      },
      body: JSON.stringify({ action: 'hitl_callback', order_id: 'ORD-1042', decision: 'APPROVED' })
    });
    assert.equal(invalidCbRes.status, 401);

    const validCbRes = await app.request('http://127.0.0.1:8080/api/agentic-transaction/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId,
        'X-Agent-Callback-Token': TEST_CALLBACK_SECRET
      },
      body: JSON.stringify({ action: 'hitl_callback', order_id: 'ORD-1042', decision: 'APPROVED' })
    });
    assert.equal(validCbRes.status, 200);
    const validCbData = (await validCbRes.json()) as {
      status: string;
      new_status: string;
      updated_record: { current_status: string };
    };
    assert.equal(validCbData.status, 'APPROVED_RELEASED');
    assert.equal(validCbData.new_status, 'RELEASED');
    assert.equal(validCbData.updated_record.current_status, 'RELEASED');
  });
});
