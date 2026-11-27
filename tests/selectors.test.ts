import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resetToCanonicalSeed } from '../src/engine/simulationEngine';
import {
  getActionButtonGates,
  getElenaPendingBadge,
  getGlobalStatusLabel,
  getPendingApprovals,
  getSelectedErpRecord
} from '../src/engine/agenticSelectors';

describe('Layer 3: Agentic Transaction Pure Selectors', () => {
  it('computes Elena pending badge across multiple pending orders (regression test)', () => {
    const base = resetToCanonicalSeed();
    assert.equal(getPendingApprovals(base).length, 0);
    assert.equal(getElenaPendingBadge(base), null);

    // Escalate 2 orders to PROCESSING
    const twoPending = {
      ...base,
      erp_records: base.erp_records.map((r, idx) =>
        idx < 2 ? { ...r, current_status: 'PROCESSING' as const } : r
      )
    };
    assert.equal(getPendingApprovals(twoPending).length, 2);
    assert.deepEqual(getElenaPendingBadge(twoPending), {
      text: '2 Pending',
      tone: 'amber',
      pulse: true
    });

    // Approve 1 order -> 1 Pending remains
    const onePending = {
      ...twoPending,
      erp_records: twoPending.erp_records.map((r, idx) =>
        idx === 0 ? { ...r, current_status: 'RELEASED' as const } : r
      )
    };
    assert.equal(getPendingApprovals(onePending).length, 1);
    assert.deepEqual(getElenaPendingBadge(onePending), {
      text: '1 Pending',
      tone: 'amber',
      pulse: true
    });
  });

  it('computes global status label and action button gates', () => {
    const base = resetToCanonicalSeed();
    assert.equal(getGlobalStatusLabel(base), 'Ready');
    assert.deepEqual(getActionButtonGates(base), {
      canRunStage1: true,
      canRunStage2: false,
      canRunStage3Audit: false,
      canApproveHitl: false
    });

    const selected = getSelectedErpRecord(base);
    assert.equal(selected?.order_id, base.selected_order_id);
  });
});
