import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeStage1TokenExchange,
  executeStage2McpPolicy,
  executeStage3BedrockAudit,
  executeStage3HitlCallback,
  resetToCanonicalSeed
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
});
