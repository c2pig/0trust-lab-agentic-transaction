import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPlaygroundState,
  executeStage1TokenExchange,
  executeStage2McpPolicy,
  executeStage3BedrockAudit,
  executeStage3HitlCallback,
  loadPlaygroundState,
  resetToCanonicalSeed,
  savePlaygroundState
} from '../src/engine/simulationEngine';

describe('Layer 3: Simulation Engine Invariants', () => {
  it('Stage 1 token exchange fails closed on RAW_JWT_FORWARD, ID_JAG_WRONG_AUD, and SPOOF_GCP_SA', () => {
    const base = resetToCanonicalSeed();

    for (const attackMode of ['RAW_JWT_FORWARD', 'ID_JAG_WRONG_AUD', 'SPOOF_GCP_SA'] as const) {
      const next = executeStage1TokenExchange(base, attackMode);
      assert.equal(next.token_bundle?.status, 'ATTACK_BLOCKED', `Expected ATTACK_BLOCKED for ${attackMode}`);
      assert.ok(next.token_bundle?.error_code);
    }

    const valid = executeStage1TokenExchange(base, 'NONE');
    assert.equal(valid.token_bundle?.status, 'VALIDATED');
  });

  it('Stage 2 MCP policy blocks RBAC_VIOLATION and DLP_SECRET_LEAK without mutating erp_records', () => {
    const base = executeStage1TokenExchange(resetToCanonicalSeed(), 'NONE');
    const initialRecords = JSON.stringify(base.erp_records);

    const rbacBlocked = executeStage2McpPolicy(base, 'RBAC_VIOLATION');
    assert.equal(rbacBlocked.mcp_result?.overall_decision, 'DENIED_RBAC');
    assert.equal(JSON.stringify(rbacBlocked.erp_records), initialRecords);

    const dlpBlocked = executeStage2McpPolicy(base, 'DLP_SECRET_LEAK');
    assert.equal(dlpBlocked.mcp_result?.overall_decision, 'DENIED_DLP');
    assert.equal(JSON.stringify(dlpBlocked.erp_records), initialRecords);

    const lowValue = executeStage2McpPolicy(base, 'LOW_VALUE_AUTO');
    assert.equal(lowValue.mcp_result?.overall_decision, 'ALLOWED');
    assert.equal(lowValue.mcp_result?.hitl_status, 'AUTO_APPROVED');
  });

  it('Stage 3 transitions order BLOCKED -> PROCESSING -> RELEASED on approval', () => {
    const base = executeStage1TokenExchange(resetToCanonicalSeed(), 'NONE');
    const processing = executeStage3BedrockAudit(base, 'ORD-1042');
    assert.equal(
      processing.erp_records.find((r) => r.order_id === 'ORD-1042')?.current_status,
      'PROCESSING'
    );

    const released = executeStage3HitlCallback(processing, 'ORD-1042', 'APPROVED', 'Verified PO', true);
    assert.equal(
      released.erp_records.find((r) => r.order_id === 'ORD-1042')?.current_status,
      'RELEASED'
    );
  });

  it('does not persist or reload mutated state across leases via localStorage', () => {
    const store = new Map<string, string>();
    const prevStorage = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      }
    };

    try {
      const mutated = executeStage1TokenExchange(resetToCanonicalSeed(), 'NONE');
      savePlaygroundState(mutated);
      assert.equal(store.size, 0);

      // Even if a legacy entry exists in localStorage, loadPlaygroundState clears it and returns fresh seed
      store.set('0trust_agentic_tx_state_v1', JSON.stringify(mutated));
      const reloaded = loadPlaygroundState();
      assert.equal(reloaded.token_bundle, null);
      assert.equal(store.has('0trust_agentic_tx_state_v1'), false);

      store.set('0trust_agentic_tx_state_v1', JSON.stringify(mutated));
      clearPlaygroundState();
      assert.equal(store.has('0trust_agentic_tx_state_v1'), false);
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = prevStorage;
    }
  });
});
