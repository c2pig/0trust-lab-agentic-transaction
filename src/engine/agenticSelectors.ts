import type { ErpExceptionRecord, PlaygroundState } from '../types';

export interface SeatBadge {
  text: string;
  tone: 'amber' | 'emerald';
  pulse?: boolean;
}

export interface ActionButtonGates {
  canRunStage1: boolean;
  canRunStage2: boolean;
  canRunStage3Audit: boolean;
  canApproveHitl: boolean;
}

/**
 * Returns the currently selected ERP record, falling back to the first record.
 */
export function getSelectedErpRecord(state: PlaygroundState): ErpExceptionRecord | undefined {
  return (
    state.erp_records.find((r) => r.order_id === state.selected_order_id) ||
    state.erp_records[0]
  );
}

/**
 * Returns all ERP records currently awaiting Finance Manager HITL approval.
 */
export function getPendingApprovals(state: PlaygroundState): ErpExceptionRecord[] {
  return state.erp_records.filter((r) => r.current_status === 'PROCESSING');
}

/**
 * Computes Elena Vance's (Finance Manager) seat badge from all pending approvals.
 */
export function getElenaPendingBadge(state: PlaygroundState): SeatBadge | null {
  const pendingCount = getPendingApprovals(state).length;
  if (pendingCount === 0) return null;
  return {
    text: `${pendingCount} Pending`,
    tone: 'amber',
    pulse: true
  };
}

/**
 * Computes the top-level status label for the workspace header.
 */
export function getGlobalStatusLabel(state: PlaygroundState): string {
  const selectedRecord = getSelectedErpRecord(state);
  if (selectedRecord?.current_status === 'RELEASED') {
    return 'Order Released';
  }
  if (selectedRecord?.current_status === 'PROCESSING') {
    return 'Pending Manager Approval';
  }
  if (state.token_bundle?.status === 'VALIDATED') {
    return 'AI Access Scoped';
  }
  return 'Ready';
}

/**
 * Computes which stage actions are enabled for the currently selected order.
 */
export function getActionButtonGates(state: PlaygroundState): ActionButtonGates {
  const selectedRecord = getSelectedErpRecord(state);
  const isTokenValidated = state.token_bundle?.status === 'VALIDATED';
  const isProcessing = selectedRecord?.current_status === 'PROCESSING';
  const isReleased = selectedRecord?.current_status === 'RELEASED';

  return {
    canRunStage1: true,
    canRunStage2: isTokenValidated,
    canRunStage3Audit: isTokenValidated && !isReleased && !isProcessing,
    canApproveHitl: isProcessing
  };
}
