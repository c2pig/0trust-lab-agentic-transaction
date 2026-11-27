import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, Compass, RotateCcw } from 'lucide-react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import {
  ErpExceptionRecord,
  ErpRecordStatus,
  ObservabilitySpan,
  PlaygroundState
} from '../types';
import {
  callStage1ExchangeApi,
  callStage2ExecuteApi,
  callStage3ApproveApi,
  createAgenticVisitorSessionId
} from '../engine/simulationEngine';
import {
  getElenaPendingBadge,
  getGlobalStatusLabel
} from '../engine/agenticSelectors';
import { RoleSeatItem, RoleSwitcherBar } from '../components/RoleSwitcherBar';
import {
  XRayDecodedProofSection,
  XRayTelemetryDrawer
} from '../components/XRayTelemetryDrawer';

export interface AgenticTransactionPageProps {
  state: PlaygroundState;
  onChangeState: (next: PlaygroundState) => void;
  onBackHome: () => void;
  onResetLab: () => void;
}

type SeatId = 'sales-ops' | 'ai-sec' | 'finance-mgr';

interface AgentActivityRow {
  id: string;
  time: string;
  actor: string;
  orderId: string;
  activity: string;
  policyGate: string;
  status: 'SCOPED 15M' | 'ESCALATED' | 'AUTO-CLEARED' | 'APPROVED' | 'DENIED';
}

const DEFAULT_JUSTIFICATION = 'Approved: Executive credit override verified against collateral';

function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(amount);
}

function nowTimeStr(): string {
  return new Date().toTimeString().slice(0, 8);
}

function getStatusBadge(status: ErpRecordStatus) {
  switch (status) {
    case 'BLOCKED':
      return <span className="badge badge-crimson">BLOCKED</span>;
    case 'PROCESSING':
      return <span className="badge badge-amber">PENDING APPROVAL</span>;
    case 'RELEASED':
      return <span className="badge badge-emerald">RELEASED</span>;
  }
}

export function AgenticTransactionPage({
  state,
  onChangeState,
  onBackHome,
  onResetLab
}: AgenticTransactionPageProps) {
  const [sessionId, setSessionId] = useState<string>(() => createAgenticVisitorSessionId());
  const sessionIdRef = useRef<string>(sessionId);
  sessionIdRef.current = sessionId;

  const stateRef = useRef<PlaygroundState>(state);
  stateRef.current = state;

  const [activeSeat, setActiveSeat] = useState<SeatId>('sales-ops');
  const [copilotLoading, setCopilotLoading] = useState<boolean>(false);
  const [approvalLoading, setApprovalLoading] = useState<boolean>(false);
  const [justification, setJustification] = useState<string>(DEFAULT_JUSTIFICATION);
  const [activityRows, setActivityRows] = useState<AgentActivityRow[]>([]);
  const [spans, setSpans] = useState<ObservabilitySpan[]>([]);

  const tourLaunchedRef = useRef<boolean>(false);

  const recordSpan = useCallback((span: ObservabilitySpan) => {
    setSpans((prev) => [span, ...prev].slice(0, 40));
  }, []);

  const appendActivityRow = useCallback((row: Omit<AgentActivityRow, 'id' | 'time'>) => {
    setActivityRows((prev) => [
      {
        ...row,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        time: nowTimeStr()
      },
      ...prev
    ]);
  }, []);

  const selectedRecord: ErpExceptionRecord =
    state.erp_records.find((r) => r.order_id === state.selected_order_id) ||
    state.erp_records[0];

  const tokenBundle = state.token_bundle;
  const mcpResult = state.mcp_result;
  const sigv4 = state.bedrock_sigv4_inspection;

  const isPendingApproval = selectedRecord?.current_status === 'PROCESSING';
  const isReleased = selectedRecord?.current_status === 'RELEASED';

  const startLabTour = useCallback(() => {
    const driverObj = driver({
      showProgress: true,
      animate: true,
      allowClose: true,
      overlayOpacity: 0.5,
      steps: [
        {
          popover: {
            title: 'Lab Orientation: Controlled AI Financial Actions',
            description:
              'Welcome to this interactive lab. You will see how an AI Copilot assists Sales Ops with blocked orders while enforcing a $200 autonomous spending limit and Finance Manager sign-off.'
          }
        },
        {
          element: '#tour-role-switcher',
          popover: {
            title: 'Role Switcher',
            description:
              'Use this dropdown to switch between Sarah Chen (Sales Ops), Marcus Thorne (AI Security), and Elena Vance (Finance Manager). Notification dots alert you when another role has a pending item.'
          }
        },
        {
          element: '#tour-workspace',
          popover: {
            title: 'Role Workspace',
            description:
              'This main area renders the live application for your active role. Start as Sarah Chen in ApexCRM and ask the AI Copilot to process a blocked order.'
          }
        },
        {
          element: '.xray-drawer',
          popover: {
            title: 'X-Ray Telemetry Drawer',
            description:
              'Expand this bottom drawer anytime to inspect live HTTP spans, scoped 15-minute AI tokens, and policy evaluations.'
          }
        },
        {
          element: '#tour-lab-controls',
          popover: {
            title: 'Lab Controls',
            description:
              'Use Lab Tour to replay this orientation, or Reset to restore all orders to their initial state.'
          }
        }
      ]
    });
    driverObj.drive();
  }, []);

  useEffect(() => {
    if (tourLaunchedRef.current) return;
    tourLaunchedRef.current = true;
    const timer = window.setTimeout(() => {
      startLabTour();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [startLabTour]);

  const handleSelectOrder = (orderId: string) => {
    const rec =
      stateRef.current.erp_records.find((r) => r.order_id === orderId) ||
      stateRef.current.erp_records[0];
    onChangeState({
      ...stateRef.current,
      selected_order_id: rec.order_id,
      active_erp_tab: rec.process
    });
  };

  // Sarah Chen: Ask AI Copilot to review & process selected order
  const handleRunCopilot = async () => {
    const currentSid = sessionIdRef.current;
    setCopilotLoading(true);

    // Step 1: Issue 15m scoped AI access pass
    const s1Res = await callStage1ExchangeApi(
      { ...stateRef.current, active_stage: 1, persona: 'erp-operator' },
      currentSid,
      'NONE'
    );
    if (sessionIdRef.current !== currentSid) return;
    recordSpan(s1Res.span);
    onChangeState(s1Res.nextState);

    appendActivityRow({
      actor: 'Sarah Chen → AI Copilot',
      orderId: selectedRecord.order_id,
      activity: '15m Scoped AI Access Issued',
      policyGate: 'Token Exchange',
      status: 'SCOPED 15M'
    });

    // Step 2: Evaluate order against autonomous spending threshold ($200)
    const isLowValue = selectedRecord.amount_usd <= 200;
    const scenario = isLowValue ? 'LOW_VALUE_AUTO' : 'COMPLIANT_AUDIT';
    const s2Res = await callStage2ExecuteApi(s1Res.nextState, currentSid, scenario);
    if (sessionIdRef.current !== currentSid) return;
    recordSpan(s2Res.span);

    if (isLowValue) {
      onChangeState({ ...s2Res.nextState, active_stage: 2 });
      appendActivityRow({
        actor: 'AI Copilot',
        orderId: selectedRecord.order_id,
        activity: `Auto-cleared (${formatUsd(selectedRecord.amount_usd)})`,
        policyGate: 'Within $200 Limit',
        status: 'AUTO-CLEARED'
      });
      setCopilotLoading(false);
      return;
    }

    // Prepare AI risk summary for Finance Manager review
    const s3Res = await callStage3ApproveApi(s2Res.nextState, currentSid, {
      action: 'bedrock_advisory',
      orderId: selectedRecord.order_id,
      simulateTimeout: false
    });
    if (sessionIdRef.current !== currentSid) return;
    recordSpan(s3Res.span);
    onChangeState({ ...s3Res.nextState, active_stage: 3 });

    appendActivityRow({
      actor: 'AI Copilot',
      orderId: selectedRecord.order_id,
      activity: `Escalated (${formatUsd(selectedRecord.amount_usd)})`,
      policyGate: 'Exceeds $200 Limit',
      status: 'ESCALATED'
    });

    setCopilotLoading(false);
  };

  // Elena Vance: Approve or Deny in Finance Approval Inbox
  const handleManagerDecision = async (decision: 'APPROVED' | 'DENIED') => {
    const currentSid = sessionIdRef.current;
    setApprovalLoading(true);

    const reasonText =
      decision === 'APPROVED'
        ? justification
        : 'Denied: Exposure exceeds risk appetite; hold maintained.';

    const res = await callStage3ApproveApi(stateRef.current, currentSid, {
      action: 'hitl_callback',
      orderId: selectedRecord.order_id,
      decision,
      justification: reasonText,
      tokenValid: true
    });

    if (sessionIdRef.current !== currentSid) return;
    setApprovalLoading(false);
    recordSpan(res.span);
    onChangeState({ ...res.nextState, active_stage: 3 });

    appendActivityRow({
      actor: 'Elena Vance (Finance Manager)',
      orderId: selectedRecord.order_id,
      activity: decision === 'APPROVED' ? 'Approved Order Release' : 'Denied Order Release',
      policyGate: 'Manager Sign-Off',
      status: decision === 'APPROVED' ? 'APPROVED' : 'DENIED'
    });
  };

  const handleReset = () => {
    setSessionId(createAgenticVisitorSessionId());
    setActiveSeat('sales-ops');
    setCopilotLoading(false);
    setApprovalLoading(false);
    setJustification(DEFAULT_JUSTIFICATION);
    setActivityRows([]);
    setSpans([]);
    onResetLab();
  };

  const globalStatusLabel = getGlobalStatusLabel(state);

  const seats: RoleSeatItem<SeatId>[] = [
    {
      id: 'sales-ops',
      name: 'Sarah Chen',
      roleLabel: 'Sales Ops',
      appLabel: 'ApexCRM + AI Copilot',
      avatarInitials: 'SC',
      badge: isReleased ? { text: 'Released', tone: 'emerald' } : null
    },
    {
      id: 'ai-sec',
      name: 'Marcus Thorne',
      roleLabel: 'AI Security',
      appLabel: 'Agent Activity Monitor',
      avatarInitials: 'MT',
      badge: null
    },
    {
      id: 'finance-mgr',
      name: 'Elena Vance',
      roleLabel: 'Finance Manager',
      appLabel: 'Finance Approval Inbox',
      avatarInitials: 'EV',
      badge: getElenaPendingBadge(state)
    }
  ];

  const decodedProofSections: XRayDecodedProofSection[] = [
    ...(tokenBundle
      ? [
          {
            id: 'stage1-id-jag',
            label: 'Scoped AI Pass (900s ID-JAG)',
            payload: tokenBundle.okta_id_jag_jwt.payload
          }
        ]
      : []),
    ...(mcpResult
      ? [
          {
            id: 'stage2-mcp',
            label: 'MCP Policy Evaluation',
            payload: mcpResult.jsonrpc_response
          }
        ]
      : []),
    ...(sigv4
      ? [
          {
            id: 'stage3-advisory',
            label: 'AI Risk Advisory',
            payload: sigv4
          }
        ]
      : [])
  ];

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-canvas)',
        color: 'var(--text-primary)'
      }}
    >
      {/* 1. Compact AppShell Top Header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid var(--border-subtle)'
        }}
      >
        <div
          style={{
            maxWidth: '1280px',
            margin: '0 auto',
            padding: '0 16px',
            height: '56px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <button
              type="button"
              onClick={onBackHome}
              className="btn btn-sm"
              style={{ padding: '5px 9px' }}
              title="All Labs"
            >
              <ArrowLeft size={13} />
              <span>All Labs</span>
            </button>
            <span
              style={{
                fontSize: '14px',
                fontWeight: 700,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap'
              }}
            >
              Controlled AI Financial Actions
            </span>
            <span className="badge" style={{ whiteSpace: 'nowrap', fontSize: '12px' }}>
              {globalStatusLabel}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <RoleSwitcherBar
              seats={seats}
              activeSeatId={activeSeat}
              onSelectSeat={setActiveSeat}
              variant="dropdown"
              ariaLabel="Switch workspace persona"
            />

            <div id="tour-lab-controls" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                onClick={startLabTour}
                className="btn btn-sm"
                style={{
                  backgroundColor: 'var(--accent-primary-dim)',
                  borderColor: 'var(--accent-primary-border)',
                  color: 'var(--accent-primary-ink)',
                  fontSize: '13px'
                }}
              >
                <Compass size={14} />
                <span>Lab Tour</span>
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="btn btn-sm"
                style={{ fontSize: '13px' }}
              >
                <RotateCcw size={14} />
                <span>Reset</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 2. Center Role Workspace */}
      <main id="tour-workspace" style={{ flex: 1, padding: '16px' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* ==================== SEAT 1: SARAH CHEN — APEXCRM + AI COPILOT ==================== */}
          {activeSeat === 'sales-ops' && (
            <section
              aria-label="ApexCRM and AI Copilot"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-sm)',
                overflow: 'hidden'
              }}
            >
              {/* CRM Header Bar */}
              <div
                style={{
                  padding: '10px 18px',
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '5px',
                      backgroundColor: '#2563eb',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '12px'
                    }}
                  >
                    AC
                  </span>
                  <span style={{ fontSize: '15px', fontWeight: 700 }}>ApexCRM</span>
                  <span
                    style={{
                      fontSize: '13px',
                      color: '#cbd5e1',
                      borderLeft: '1px solid #334155',
                      paddingLeft: '10px'
                    }}
                  >
                    Enterprise Accounts · Order Exceptions
                  </span>
                </div>
                <span style={{ fontSize: '13px', color: '#e2e8f0' }}>
                  Sarah Chen · Sales Ops
                </span>
              </div>

              {/* CRM Split: Orders Table + AI Copilot Panel */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr' }}>
                {/* Orders Table */}
                <div style={{ borderRight: '1px solid var(--border-subtle)' }}>
                  <div
                    style={{
                      padding: '12px 18px',
                      borderBottom: '1px solid var(--border-subtle)',
                      backgroundColor: 'var(--bg-canvas)'
                    }}
                  >
                    <h2 style={{ fontSize: '15px', fontWeight: 700 }}>Blocked Customer Orders</h2>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      Select an order to review with the AI Copilot.
                    </p>
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Order ID</th>
                          <th>Customer</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.erp_records.map((rec) => {
                          const isSelected = rec.order_id === selectedRecord.order_id;
                          return (
                            <tr
                              key={rec.order_id}
                              className={`clickable-row ${isSelected ? 'selected-row' : ''}`}
                              onClick={() => handleSelectOrder(rec.order_id)}
                            >
                              <td className="mono" style={{ fontWeight: 700 }}>
                                {rec.order_id}
                              </td>
                              <td>
                                <div style={{ fontWeight: 600 }}>{rec.customer_name}</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                  Risk: {rec.risk_tier}
                                </div>
                              </td>
                              <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                                {formatUsd(rec.amount_usd)}
                              </td>
                              <td>{getStatusBadge(rec.current_status)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Embedded AI Copilot Panel */}
                <div
                  style={{
                    padding: '18px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '14px',
                    backgroundColor: 'var(--bg-canvas)'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '6px',
                          backgroundColor: 'var(--accent-primary-dim)',
                          border: '1px solid var(--accent-primary-border)',
                          color: 'var(--accent-primary)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <Bot size={16} />
                      </span>
                      <div>
                        <h3 style={{ fontSize: '15px', fontWeight: 700 }}>AI Order Copilot</h3>
                        <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                          Autonomous limit: $200 per order
                        </p>
                      </div>
                    </div>

                    <div
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '8px',
                        padding: '12px 14px',
                        fontSize: '13.5px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Selected Order</span>
                        <strong className="mono">{selectedRecord.order_id}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Customer</span>
                        <strong>{selectedRecord.customer_name}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Order Value</span>
                        <strong className="mono">{formatUsd(selectedRecord.amount_usd)}</strong>
                      </div>
                    </div>

                    {isPendingApproval && (
                      <div
                        style={{
                          padding: '12px 14px',
                          borderRadius: '8px',
                          backgroundColor: 'var(--accent-amber-dim)',
                          border: '1px solid var(--accent-amber-border)',
                          color: 'var(--accent-amber-ink)',
                          fontSize: '13px'
                        }}
                      >
                        <strong>Manager Approval Required:</strong> {selectedRecord.order_id} (
                        {formatUsd(selectedRecord.amount_usd)}) exceeds the $200 autonomous limit and is
                        queued for Finance Manager review.
                      </div>
                    )}

                    {isReleased && (
                      <div
                        style={{
                          padding: '12px 14px',
                          borderRadius: '8px',
                          backgroundColor: 'var(--accent-emerald-dim)',
                          border: '1px solid var(--accent-emerald-border)',
                          color: 'var(--accent-emerald-ink)',
                          fontSize: '13px'
                        }}
                      >
                        <strong>Order Released:</strong> {selectedRecord.order_id} has been approved and
                        released for fulfillment.
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: '100%', padding: '10px 14px', fontSize: '13.5px' }}
                    disabled={copilotLoading || isReleased}
                    onClick={() => void handleRunCopilot()}
                  >
                    {copilotLoading
                      ? 'Copilot Reviewing Order…'
                      : isReleased
                        ? 'Order Already Released'
                        : `Ask AI Copilot to Process ${selectedRecord.order_id}`}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* ==================== SEAT 2: MARCUS THORNE — AGENT ACTIVITY MONITOR ==================== */}
          {activeSeat === 'ai-sec' && (
            <section
              aria-label="Agent Activity and Policy Monitor"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-sm)',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  padding: '10px 18px',
                  backgroundColor: 'var(--bg-canvas)',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '5px',
                      backgroundColor: '#059669',
                      color: '#ffffff',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '12px'
                    }}
                  >
                    AM
                  </span>
                  <span style={{ fontSize: '15px', fontWeight: 700 }}>
                    Agent Activity &amp; Policy Monitor
                  </span>
                </div>
                <span style={{ fontSize: '13.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Marcus Thorne · AI Security
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Actor</th>
                      <th>Order</th>
                      <th>Activity</th>
                      <th>Policy Gate</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '28px' }}>
                          No AI Copilot activity recorded yet.
                        </td>
                      </tr>
                    ) : (
                      activityRows.map((row) => {
                        const badgeClass =
                          row.status === 'APPROVED' || row.status === 'AUTO-CLEARED'
                            ? 'badge-emerald'
                            : row.status === 'ESCALATED'
                              ? 'badge-amber'
                              : row.status === 'DENIED'
                                ? 'badge-crimson'
                                : 'badge-blue';
                        return (
                          <tr key={row.id}>
                            <td className="mono" style={{ color: 'var(--text-muted)' }}>
                              {row.time}
                            </td>
                            <td style={{ fontWeight: 600 }}>{row.actor}</td>
                            <td className="mono">{row.orderId}</td>
                            <td>{row.activity}</td>
                            <td>{row.policyGate}</td>
                            <td>
                              <span className={`badge ${badgeClass}`}>{row.status}</span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ==================== SEAT 3: ELENA VANCE — FINANCE APPROVAL INBOX ==================== */}
          {activeSeat === 'finance-mgr' && (
            <section
              aria-label="Finance Approval Inbox"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-sm)',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  padding: '10px 18px',
                  backgroundColor: 'var(--bg-canvas)',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '5px',
                      backgroundColor: '#7c3aed',
                      color: '#ffffff',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '12px'
                    }}
                  >
                    FA
                  </span>
                  <span style={{ fontSize: '15px', fontWeight: 700 }}>Finance Approval Inbox</span>
                </div>
                <span style={{ fontSize: '13.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Elena Vance · Finance Manager
                </span>
              </div>

              <div style={{ padding: '18px' }}>
                {isPendingApproval ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <h3 style={{ fontSize: '15.5px', fontWeight: 700 }}>
                        Pending Financial Approvals
                      </h3>
                      <span className="badge badge-amber" style={{ fontSize: '12px' }}>
                        1 Awaiting Sign-Off
                      </span>
                    </div>

                    <div className="data-table-wrapper">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Who</th>
                            <th>Order &amp; Amount</th>
                            <th>Business Justification</th>
                            <th style={{ textAlign: 'right' }}>Decision</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>
                              <div style={{ fontWeight: 700 }}>Sarah Chen</div>
                              <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                                Sales Ops (via AI Copilot)
                              </div>
                            </td>
                            <td>
                              <div style={{ fontWeight: 700 }}>
                                {selectedRecord.order_id} · {formatUsd(selectedRecord.amount_usd)}
                              </div>
                              <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                                {selectedRecord.customer_name}
                              </div>
                            </td>
                            <td style={{ minWidth: '260px' }}>
                              <input
                                type="text"
                                value={justification}
                                onChange={(e) => setJustification(e.target.value)}
                                className="input-control"
                                style={{ fontSize: '13px' }}
                              />
                            </td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'inline-flex', gap: '8px' }}>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  style={{ fontSize: '13px', padding: '7px 12px' }}
                                  disabled={approvalLoading}
                                  onClick={() => void handleManagerDecision('DENIED')}
                                >
                                  Deny
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  disabled={approvalLoading}
                                  onClick={() => void handleManagerDecision('APPROVED')}
                                  style={{
                                    fontSize: '13px',
                                    padding: '7px 14px',
                                    backgroundColor: '#7c3aed',
                                    borderColor: '#7c3aed',
                                    color: '#ffffff'
                                  }}
                                >
                                  {approvalLoading ? 'Approving…' : 'Approve Release'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : isReleased ? (
                  <div
                    style={{
                      border: '1px solid var(--accent-emerald-border)',
                      backgroundColor: 'var(--accent-emerald-dim)',
                      borderRadius: 'var(--radius-md)',
                      padding: '16px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <h3 style={{ fontSize: '15.5px', fontWeight: 700 }}>
                        Order {selectedRecord.order_id} Approved &amp; Released
                      </h3>
                      <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                        {selectedRecord.customer_name} ({formatUsd(selectedRecord.amount_usd)}) cleared
                        for fulfillment.
                      </p>
                    </div>
                    <span className="badge badge-emerald" style={{ fontSize: '12.5px' }}>
                      RELEASED
                    </span>
                  </div>
                ) : (
                  <div
                    style={{
                      border: '1px dashed var(--border-strong)',
                      borderRadius: 'var(--radius-md)',
                      padding: '32px 18px',
                      textAlign: 'center',
                      backgroundColor: 'var(--bg-canvas)'
                    }}
                  >
                    <h3 style={{ fontSize: '15.5px', fontWeight: 700 }}>Approval Inbox Clear</h3>
                    <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      No high-value orders awaiting your sign-off.
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </main>

      {/* 3. Original Sticky-Bottom X-Ray Telemetry Drawer */}
      <XRayTelemetryDrawer
        spans={spans}
        sessionJwt={tokenBundle?.okta_id_jag_jwt.raw_jwt}
        sessionClaims={
          tokenBundle
            ? {
                header: tokenBundle.okta_id_jag_jwt.header,
                payload: tokenBundle.okta_id_jag_jwt.payload
              }
            : null
        }
        decodedProofSections={decodedProofSections}
        onClear={() => setSpans([])}
      />
    </div>
  );
}
