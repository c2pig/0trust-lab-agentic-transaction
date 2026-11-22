import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  FileCode2,
  KeyRound,
  Loader2,
  Lock,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserCheck,
  XCircle,
  Zap
} from 'lucide-react';
import {
  AgentPersona,
  ErpExceptionRecord,
  ErpRecordStatus,
  ObservabilitySpan,
  PlaygroundState
} from '../types';
import {
  callStage1ExchangeApi,
  callStage2ExecuteApi,
  callStage3ApproveApi,
  createAgenticVisitorSessionId,
  Stage1AttackMode,
  Stage2Scenario
} from '../engine/simulationEngine';
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
type PoePredictionId = 'A' | 'B' | 'C';

interface ExploredTrapsState {
  attackA_rawJwt: boolean;
  attackB_wrongAud: boolean;
  attackC_spoofSa: boolean;
  attackD_dlpSecret: boolean;
  attackE_rbacViolation: boolean;
  testF_bedrockTimeout: boolean;
  testG_forgedCallback: boolean;
  poeHypothesisVerified: boolean;
}

const INITIAL_TRAPS: ExploredTrapsState = {
  attackA_rawJwt: false,
  attackB_wrongAud: false,
  attackC_spoofSa: false,
  attackD_dlpSecret: false,
  attackE_rbacViolation: false,
  testF_bedrockTimeout: false,
  testG_forgedCallback: false,
  poeHypothesisVerified: false
};

const JUSTIFICATION_TEMPLATES = [
  'Approved: Executive credit override verified against collateral',
  'Approved: Strategic customer expansion — temporary credit buffer authorized',
  'Denied: Exposure exceeds risk appetite; hold maintained pending wire settlement',
  'Denied: Past-due balance requires CFO sign-off prior to release'
];

const POE_HYPOTHESES: Array<{
  id: PoePredictionId;
  title: string;
  description: string;
  isCorrect: boolean;
}> = [
  {
    id: 'A',
    title: 'Prediction A · Autonomous AI Release',
    description:
      'AI Copilot autonomously releases the $145,000 order because Step 1 OAuth/STS identity succeeded.',
    isCorrect: false
  },
  {
    id: 'B',
    title: 'Prediction B · MCP HITL Escalation (>$200.00 Threshold)',
    description:
      'MCP Proxy passes RBAC & DLP, halts autonomous execution because $145,000 > $200.00 (HITL-001), and escalates to the Finance Manager ServiceNow HITL queue (PENDING_HUMAN_APPROVAL).',
    isCorrect: true
  },
  {
    id: 'C',
    title: 'Prediction C · RBAC Tool Deny (-32001)',
    description:
      'MCP Proxy blocks the erp-operator request immediately with JSON-RPC -32001 ToolExecutionDenied.',
    isCorrect: false
  }
];

function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(amount);
}

function getStatusBadge(status: ErpRecordStatus) {
  switch (status) {
    case 'BLOCKED':
      return <span className="badge badge-crimson">BLOCKED</span>;
    case 'PROCESSING':
      return <span className="badge badge-amber">PROCESSING · AWAITING HITL</span>;
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

  // 3-Seat Role Switcher State (Archetype A)
  const [activeSeat, setActiveSeat] = useState<SeatId>('sales-ops');
  const [copilotRoutedToMcp, setCopilotRoutedToMcp] = useState<boolean>(false);

  // Predict-Observe-Explain (POE) Gate State (Archetype C)
  const [selectedPrediction, setSelectedPrediction] = useState<PoePredictionId | null>(null);
  const [poeObserved, setPoeObserved] = useState<boolean>(false);

  // Stage 3 Human Manager Sign-Off & Safeguards
  const [justification, setJustification] = useState(JUSTIFICATION_TEMPLATES[0]);
  const [forgedCallbackBlocked, setForgedCallbackBlocked] = useState<boolean>(false);
  const [bedrockTimeoutTriggered, setBedrockTimeoutTriggered] = useState<boolean>(false);

  // Animation & Async Loading States
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [animatingHop, setAnimatingHop] = useState<number>(0); // 0 = idle, 1..3 = active hop
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [isCallbackSubmitting, setIsCallbackSubmitting] = useState(false);

  // Phase 4 Reflection Checklist & Sticky X-Ray Spans
  const [exploredTraps, setExploredTraps] = useState<ExploredTrapsState>(INITIAL_TRAPS);
  const [spans, setSpans] = useState<ObservabilitySpan[]>([]);

  const timerRefs = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timerRefs.current.forEach((id) => window.clearTimeout(id));
    timerRefs.current = [];
  }, []);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const recordSpan = useCallback((span: ObservabilitySpan) => {
    setSpans((prev) => [span, ...prev].slice(0, 40));
  }, []);

  const selectedRecord: ErpExceptionRecord =
    state.erp_records.find((r) => r.order_id === state.selected_order_id) ||
    state.erp_records[0];

  const tokenBundle = state.token_bundle;
  const mcpResult = state.mcp_result;
  const sigv4 = state.bedrock_sigv4_inspection;

  const stage1Done = tokenBundle?.status === 'VALIDATED';
  const stage2Done =
    mcpResult !== null &&
    (mcpResult.overall_decision === 'ESCALATED_HITL' ||
      mcpResult.overall_decision === 'ALLOWED');
  const stage3Done = selectedRecord?.current_status === 'RELEASED';

  const handleSelectSeat = (seat: SeatId) => {
    clearTimers();
    setAnimatingHop(0);
    const stageForSeat = seat === 'sales-ops' ? 1 : seat === 'ai-sec' ? 2 : 3;
    onChangeState({ ...stateRef.current, active_stage: stageForSeat });
    setActiveSeat(seat);
  };

  const handlePersonaChange = (persona: AgentPersona) => {
    onChangeState({ ...stateRef.current, persona });
  };

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

  // ==================== Step 1: Delegated Identity & OBO (`exchange.ts`) ====================

  const runStage1Animated = (attackMode: Stage1AttackMode) => {
    clearTimers();
    const stopHop =
      attackMode === 'RAW_JWT_FORWARD'
        ? 1
        : attackMode === 'ID_JAG_WRONG_AUD'
          ? 2
          : 3;

    const currentSid = sessionIdRef.current;

    const finishStage1 = async () => {
      const res = await callStage1ExchangeApi(stateRef.current, currentSid, attackMode);
      if (sessionIdRef.current !== currentSid) return;
      setAnimatingHop(0);
      recordSpan(res.span);
      onChangeState({ ...res.nextState, active_stage: 1 });

      if (attackMode === 'RAW_JWT_FORWARD') {
        setExploredTraps((prev) => ({ ...prev, attackA_rawJwt: true }));
      } else if (attackMode === 'ID_JAG_WRONG_AUD') {
        setExploredTraps((prev) => ({ ...prev, attackB_wrongAud: true }));
      } else if (attackMode === 'SPOOF_GCP_SA') {
        setExploredTraps((prev) => ({ ...prev, attackC_spoofSa: true }));
      }
    };

    setAnimatingHop(1);
    if (stopHop === 1) {
      const t1 = window.setTimeout(() => {
        void finishStage1();
      }, 280);
      timerRefs.current.push(t1);
      return;
    }

    const t1 = window.setTimeout(() => setAnimatingHop(2), 240);
    timerRefs.current.push(t1);

    if (stopHop === 2) {
      const t2 = window.setTimeout(() => {
        void finishStage1();
      }, 500);
      timerRefs.current.push(t2);
      return;
    }

    const t2 = window.setTimeout(() => setAnimatingHop(3), 480);
    const t3 = window.setTimeout(() => {
      void finishStage1();
    }, 720);
    timerRefs.current.push(t2, t3);
  };

  const handleRouteToMcpConsole = () => {
    setCopilotRoutedToMcp(true);
    handleSelectSeat('ai-sec');
  };

  // ==================== Step 2: MCP Policy Proxy & POE Gate (`execute.ts`) ====================

  const runStage2Animated = (scenario: Stage2Scenario) => {
    clearTimers();
    const effectiveScenario = scenario;
    const isSupportPersonaTrap =
      effectiveScenario === 'COMPLIANT_AUDIT' && stateRef.current.persona === 'support-agent';

    const stopHop =
      effectiveScenario === 'RBAC_VIOLATION' || isSupportPersonaTrap
        ? 1
        : effectiveScenario === 'DLP_SECRET_LEAK'
          ? 2
          : 3;

    const currentSid = sessionIdRef.current;

    const finishStage2 = async () => {
      const res = await callStage2ExecuteApi(stateRef.current, currentSid, effectiveScenario);
      if (sessionIdRef.current !== currentSid) return;
      setAnimatingHop(0);
      recordSpan(res.span);
      onChangeState({ ...res.nextState, active_stage: 2 });

      if (effectiveScenario === 'COMPLIANT_AUDIT' || effectiveScenario === 'LOW_VALUE_AUTO') {
        setPoeObserved(true);
        if (selectedPrediction) {
          setExploredTraps((prev) => ({ ...prev, poeHypothesisVerified: true }));
        }
      }
      if (effectiveScenario === 'DLP_SECRET_LEAK') {
        setExploredTraps((prev) => ({ ...prev, attackD_dlpSecret: true }));
      }
      if (effectiveScenario === 'RBAC_VIOLATION' || isSupportPersonaTrap) {
        setExploredTraps((prev) => ({ ...prev, attackE_rbacViolation: true }));
      }
    };

    setAnimatingHop(1);
    if (stopHop === 1) {
      const t1 = window.setTimeout(() => {
        void finishStage2();
      }, 280);
      timerRefs.current.push(t1);
      return;
    }

    const t1 = window.setTimeout(() => setAnimatingHop(2), 240);
    timerRefs.current.push(t1);

    if (stopHop === 2) {
      const t2 = window.setTimeout(() => {
        void finishStage2();
      }, 500);
      timerRefs.current.push(t2);
      return;
    }

    const t2 = window.setTimeout(() => setAnimatingHop(3), 480);
    const t3 = window.setTimeout(() => {
      void finishStage2();
    }, 720);
    timerRefs.current.push(t2, t3);
  };

  // ==================== Step 3: ServiceNow HITL & Bedrock SigV4 (`approve.ts`) ====================

  const runStage3AiReview = (orderId: string, simulateTimeout: boolean) => {
    clearTimers();
    setIsAiThinking(true);
    const currentSid = sessionIdRef.current;

    const t = window.setTimeout(async () => {
      const res = await callStage3ApproveApi(stateRef.current, currentSid, {
        action: 'bedrock_advisory',
        orderId,
        simulateTimeout
      });
      if (sessionIdRef.current !== currentSid) return;
      setIsAiThinking(false);
      recordSpan(res.span);
      onChangeState({ ...res.nextState, active_stage: 3 });

      if (simulateTimeout) {
        setBedrockTimeoutTriggered(true);
        setExploredTraps((prev) => ({ ...prev, testF_bedrockTimeout: true }));
      } else {
        setBedrockTimeoutTriggered(false);
      }
    }, 420);
    timerRefs.current.push(t);
  };

  const runStage3HitlDecision = async (
    orderId: string,
    decision: 'APPROVED' | 'DENIED',
    reasonText: string,
    tokenValid: boolean
  ) => {
    setIsCallbackSubmitting(true);
    const currentSid = sessionIdRef.current;
    const res = await callStage3ApproveApi(stateRef.current, currentSid, {
      action: 'hitl_callback',
      orderId,
      decision,
      justification: reasonText,
      tokenValid
    });
    if (sessionIdRef.current !== currentSid) return;
    setIsCallbackSubmitting(false);
    recordSpan(res.span);
    onChangeState({ ...res.nextState, active_stage: 3 });

    if (!tokenValid) {
      setForgedCallbackBlocked(true);
      setExploredTraps((prev) => ({ ...prev, testG_forgedCallback: true }));
    } else {
      setForgedCallbackBlocked(false);
    }
  };

  // ==================== Guided 3-Seat Walkthrough ====================

  const handleGuidedWalkthrough = () => {
    clearTimers();
    setIsAutoPlaying(true);
    setActiveSeat('sales-ops');
    setSelectedPrediction('B');
    const currentSid = sessionIdRef.current;

    void (async () => {
      const s1Res = await callStage1ExchangeApi(
        { ...stateRef.current, active_stage: 1, persona: 'erp-operator' },
        currentSid,
        'NONE'
      );
      if (sessionIdRef.current !== currentSid) return;
      recordSpan(s1Res.span);
      onChangeState(s1Res.nextState);
      setCopilotRoutedToMcp(true);

      const t1 = window.setTimeout(async () => {
        setActiveSeat('ai-sec');
        const s2Res = await callStage2ExecuteApi(
          { ...s1Res.nextState, active_stage: 2 },
          currentSid,
          'COMPLIANT_AUDIT'
        );
        if (sessionIdRef.current !== currentSid) return;
        recordSpan(s2Res.span);
        onChangeState(s2Res.nextState);
        setPoeObserved(true);
        setExploredTraps((prev) => ({ ...prev, poeHypothesisVerified: true }));

        const t2 = window.setTimeout(async () => {
          setActiveSeat('finance-mgr');
          const s3Res = await callStage3ApproveApi(
            { ...s2Res.nextState, active_stage: 3 },
            currentSid,
            {
              action: 'bedrock_advisory',
              orderId: s2Res.nextState.selected_order_id,
              simulateTimeout: false
            }
          );
          if (sessionIdRef.current !== currentSid) return;
          recordSpan(s3Res.span);
          onChangeState(s3Res.nextState);
          setIsAutoPlaying(false);
        }, 700);
        timerRefs.current.push(t2);
      }, 700);
      timerRefs.current.push(t1);
    })();
  };

  const handleFullReset = () => {
    clearTimers();
    const freshSid = createAgenticVisitorSessionId();
    sessionIdRef.current = freshSid;
    setSessionId(freshSid);

    setActiveSeat('sales-ops');
    setCopilotRoutedToMcp(false);
    setSelectedPrediction(null);
    setPoeObserved(false);
    setForgedCallbackBlocked(false);
    setBedrockTimeoutTriggered(false);
    setIsAutoPlaying(false);
    setAnimatingHop(0);
    setIsAiThinking(false);
    setIsCallbackSubmitting(false);
    setExploredTraps(INITIAL_TRAPS);
    setSpans([]);
    onResetLab();
  };

  // ==================== Visual Gate Hop Evaluators (Fixed Error-Code Alignment) ====================

  const getStage1HopState = (hop: 1 | 2 | 3): 'pending' | 'running' | 'passed' | 'blocked' => {
    if (animatingHop === hop) return 'running';
    if (animatingHop > hop) return 'passed';
    if (!tokenBundle) return 'pending';
    if (tokenBundle.status === 'VALIDATED') return 'passed';

    const failHop =
      tokenBundle.error_code === 'ERR_CONFUSED_DEPUTY_RAW_BEARER_REJECTED'
        ? 1
        : tokenBundle.error_code === 'ERR_ID_JAG_AUDIENCE_MISMATCH'
          ? 2
          : 3;

    if (hop < failHop) return 'passed';
    if (hop === failHop) return 'blocked';
    return 'pending';
  };

  const getStage2GateState = (
    gate: 1 | 2 | 3
  ): 'pending' | 'running' | 'passed' | 'blocked' | 'warning' => {
    if (animatingHop === gate) return 'running';
    if (animatingHop > gate) return 'passed';
    if (!mcpResult) return 'pending';

    if (gate === 1) {
      return mcpResult.rbac_status === 'DENY' ? 'blocked' : 'passed';
    }
    if (gate === 2) {
      if (mcpResult.rbac_status === 'DENY') return 'pending';
      return mcpResult.dlp_status === 'BLOCK' ? 'blocked' : 'passed';
    }
    if (mcpResult.rbac_status === 'DENY' || mcpResult.dlp_status === 'BLOCK') return 'pending';
    return mcpResult.hitl_status === 'PENDING_HUMAN_APPROVAL' ? 'warning' : 'passed';
  };

  // ==================== 3-Seat Role Switcher Badges ====================

  const salesOpsBadge: RoleSeatItem<SeatId>['badge'] =
    selectedRecord.current_status === 'RELEASED'
      ? { text: 'Order Released', tone: 'emerald' }
      : tokenBundle?.status === 'ATTACK_BLOCKED'
        ? { text: 'Attack Blocked', tone: 'crimson', pulse: true }
        : tokenBundle?.status === 'VALIDATED'
          ? { text: '900s ID-JAG Active', tone: 'emerald' }
          : { text: 'Order Blocked', tone: 'amber' };

  const aiSecBadge: RoleSeatItem<SeatId>['badge'] =
    mcpResult?.overall_decision === 'DENIED_RBAC' ||
    mcpResult?.overall_decision === 'DENIED_DLP'
      ? {
          text:
            mcpResult.overall_decision === 'DENIED_RBAC'
              ? 'Blocked (-32001)'
              : 'Blocked (-32002)',
          tone: 'crimson',
          pulse: true
        }
      : mcpResult?.overall_decision === 'ESCALATED_HITL'
        ? { text: 'HITL Escalated', tone: 'amber' }
        : mcpResult?.overall_decision === 'ALLOWED'
          ? { text: 'Auto-Approved (≤$200)', tone: 'emerald' }
          : copilotRoutedToMcp || stage1Done
            ? { text: '● Policy Check', tone: 'amber', pulse: true }
            : { text: 'POE Gate Ready', tone: 'blue' };

  const financeMgrBadge: RoleSeatItem<SeatId>['badge'] =
    forgedCallbackBlocked
      ? { text: '401 Forged Callback', tone: 'crimson', pulse: true }
      : selectedRecord.current_status === 'RELEASED'
        ? { text: 'Released', tone: 'emerald' }
        : mcpResult?.overall_decision === 'ESCALATED_HITL' ||
            selectedRecord.current_status === 'PROCESSING'
          ? { text: '● 1 Pending HITL', tone: 'amber', pulse: true }
          : { text: '0 Pending', tone: 'neutral' };

  const seats: RoleSeatItem<SeatId>[] = [
    {
      id: 'sales-ops',
      name: 'Sarah Chen',
      roleLabel: 'Sales Ops · CRM + AI Copilot',
      appLabel: 'Order-to-Cash CRM & AI Copilot',
      avatarInitials: 'SC',
      badge: salesOpsBadge
    },
    {
      id: 'ai-sec',
      name: 'Marcus Thorne',
      roleLabel: 'AI Sec · MCP Console',
      appLabel: 'MCP Policy Proxy & POE Debugger',
      avatarInitials: 'MT',
      badge: aiSecBadge
    },
    {
      id: 'finance-mgr',
      name: 'Elena Vance',
      roleLabel: 'Finance Manager · Approval Queue',
      appLabel: 'ServiceNow x_ent_erp_ovl HITL Queue',
      avatarInitials: 'EV',
      badge: financeMgrBadge
    }
  ];

  // ==================== Decoded Proof Sections for Sticky XRayTelemetryDrawer ====================

  const decodedProofSections: XRayDecodedProofSection[] = [
    {
      id: 'step1-obo-token-bundle',
      label: 'Step 1 · Frontdoor Strip & 900s Okta ID-JAG + AWS STS OBO',
      payload: tokenBundle
        ? {
            status: tokenBundle.status,
            stripped_at_frontdoor: tokenBundle.inbound_auth0_jwt.stripped_at_frontdoor,
            expires_in: 900,
            okta_id_jag_header: tokenBundle.okta_id_jag_jwt.header,
            okta_id_jag_claims: tokenBundle.okta_id_jag_jwt.payload,
            gcp_oidc_claims: tokenBundle.gcp_oidc_token.payload,
            aws_sts_assumed_role: tokenBundle.aws_sts_session.assumed_role_arn,
            invariants_verified: tokenBundle.aws_sts_session.invariants_verified
          }
        : { info: 'Run Step 1 in Seat 1 (Sales Ops) to mint the 900s (15m) Okta ID-JAG pass.' }
    },
    {
      id: 'step2-mcp-jsonrpc',
      label: 'Step 2 · MCP Policy Proxy (JSON-RPC 2.0 RBAC / DLP / HITL)',
      payload: mcpResult
        ? {
            overall_decision: mcpResult.overall_decision,
            rbac_status: mcpResult.rbac_status,
            dlp_status: mcpResult.dlp_status,
            dlp_matched_rule: mcpResult.dlp_matched_rule || null,
            hitl_status: mcpResult.hitl_status,
            hitl_ticket_id: mcpResult.hitl_ticket_id || null,
            jsonrpc_request: mcpResult.jsonrpc_request,
            jsonrpc_response: mcpResult.jsonrpc_response
          }
        : { info: 'Run Step 2 in Seat 2 (AI Sec · MCP Console) to inspect MCP JSON-RPC proof.' }
    },
    {
      id: 'step3-bedrock-sigv4-servicenow',
      label: 'Step 3 · AWS Bedrock SigV4 & ServiceNow x_ent_erp_ovl Audit',
      payload: {
        bedrock_sigv4: sigv4 || { info: 'No Bedrock SigV4 invocation yet' },
        latest_servicenow_events: state.sn_audit_events.slice(0, 3),
        latest_sys_audit_entries: state.sys_audit_log.slice(0, 3)
      }
    }
  ];

  const trapChecklist = [
    {
      key: 'attackA',
      label: 'Attack A: Raw User JWT Forward (stripped_at_frontdoor: false -> 403 Confused Deputy)',
      tested: exploredTraps.attackA_rawJwt
    },
    {
      key: 'attackB',
      label: 'Attack B: Wrong ID-JAG Audience Replay (403 ERR_ID_JAG_AUDIENCE_MISMATCH)',
      tested: exploredTraps.attackB_wrongAud
    },
    {
      key: 'attackC',
      label: 'Attack C: Spoofed GCP Service Account sub (403 ERR_AWS_STS_OIDC_SUB_MISMATCH)',
      tested: exploredTraps.attackC_spoofSa
    },
    {
      key: 'poeGate',
      label: 'Predict–Observe–Explain (POE) Hypothesis Verified on MCP Policy Proxy',
      tested: exploredTraps.poeHypothesisVerified
    },
    {
      key: 'attackD',
      label: 'Attack D: DLP Secret & SSN Leak in Tool Args (-32002 DLPViolationDetected)',
      tested: exploredTraps.attackD_dlpSecret
    },
    {
      key: 'attackE',
      label: 'Attack E: RBAC Role Violation by Support Agent (-32001 ToolExecutionDenied)',
      tested: exploredTraps.attackE_rbacViolation
    },
    {
      key: 'testF',
      label: 'Test F: Bedrock SigV4 504 Timeout Fail-Safe Rollback (PROCESSING -> BLOCKED)',
      tested: exploredTraps.testF_bedrockTimeout
    },
    {
      key: 'testG',
      label: 'Test G: Forged Manager Callback Token (401 Constant-Time Comparison Failed)',
      tested: exploredTraps.testG_forgedCallback
    }
  ];

  const exploredTrapCount = trapChecklist.filter((item) => item.tested).length;
  const showReflectionDebrief =
    stage3Done || exploredTrapCount >= 2 || (stage1Done && stage2Done && Boolean(sigv4));

  return (
    <div className="lab-shell">
      {/* Compact Capability-First Top Header */}
      <header className="lab-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onBackHome}
            aria-label="All Labs"
          >
            <ArrowLeft size={13} />
            <span>All Labs</span>
          </button>
          <span
            style={{
              fontSize: '14.5px',
              fontWeight: 700,
              letterSpacing: '-0.015em',
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            Controlled AI Financial Actions
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span
            className="badge badge-emerald"
            title="Cloudflare Pages Functions (/api/agentic-transaction/*) + STATE_KV (1h TTL) + Browser Fallback"
          >
            <Zap size={11} />
            <span>$0.00 Guided Sandbox · Edge + KV</span>
          </span>

          <button
            type="button"
            className="btn btn-emerald btn-sm"
            onClick={handleGuidedWalkthrough}
            disabled={isAutoPlaying}
          >
            <Play size={12} />
            <span>
              {isAutoPlaying ? 'Running Walkthrough…' : 'Guided Walkthrough (3 Seats)'}
            </span>
          </button>

          <button
            type="button"
            className="btn btn-sm"
            onClick={handleFullReset}
            aria-label="Reset lab session"
          >
            <RotateCcw size={12} />
            <span>Reset</span>
          </button>
        </div>
      </header>

      {/* Main Natural-Flow Workspace */}
      <main className="lab-workspace">
        {/* 3-Seat Role Switcher Bar (Archetype A) */}
        <RoleSwitcherBar
          seats={seats}
          activeSeatId={activeSeat}
          onSelectSeat={handleSelectSeat}
          ariaLabel="Controlled AI Financial Actions 3-Seat Role Switcher"
        />

        {/* 4-Phase Cognitive Arc & Active Order Status Bar */}
        <section
          aria-label="Cognitive Arc and Order Context"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            marginBottom: '14px',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span
              className={`badge ${
                activeSeat === 'sales-ops'
                  ? 'badge-blue'
                  : stage1Done
                    ? 'badge-emerald'
                    : ''
              }`}
            >
              1. Discovery · Scoped 900s Pass
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>→</span>
            <span
              className={`badge ${
                activeSeat === 'ai-sec'
                  ? 'badge-blue'
                  : stage2Done
                    ? 'badge-emerald'
                    : ''
              }`}
            >
              2. Understanding · POE &amp; MCP Proxy
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>→</span>
            <span
              className={`badge ${
                activeSeat === 'finance-mgr'
                  ? 'badge-blue'
                  : stage3Done
                    ? 'badge-emerald'
                    : ''
              }`}
            >
              3. Practice · Bedrock SigV4 &amp; HITL
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>→</span>
            <span className={`badge ${showReflectionDebrief ? 'badge-emerald' : ''}`}>
              4. Reflection · Debrief ({exploredTrapCount}/{trapChecklist.length} traps)
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-primary)'
            }}
          >
            <span>
              Active Order: <code>{selectedRecord.order_id}</code> ({selectedRecord.customer_name} ·{' '}
              {formatUsd(selectedRecord.amount_usd)})
            </span>
            {getStatusBadge(selectedRecord.current_status)}
          </div>
        </section>

        {/* ==================== SEAT 1: SARAH CHEN (SALES OPS · CRM + AI COPILOT) ==================== */}
        {activeSeat === 'sales-ops' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <section
              aria-label="Sarah Chen CRM and AI Copilot Workplace"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-sm)',
                overflow: 'hidden'
              }}
            >
              {/* Workplace App Header */}
              <div
                style={{
                  padding: '12px 18px',
                  borderBottom: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-canvas)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <Bot size={16} color="#2563eb" />
                  <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Order-to-Cash CRM &amp; AI Copilot
                  </span>
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-muted)'
                    }}
                  >
                    sarah.chen@0trust.dev
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span className="badge badge-blue">
                    <Clock size={11} />
                    <span>Step 1 · 15-Minute (900s) Scoped Pass</span>
                  </span>
                  {tokenBundle && (
                    <span
                      className={`badge ${
                        tokenBundle.inbound_auth0_jwt.stripped_at_frontdoor
                          ? 'badge-emerald'
                          : 'badge-crimson'
                      }`}
                    >
                      stripped_at_frontdoor:{' '}
                      {String(tokenBundle.inbound_auth0_jwt.stripped_at_frontdoor)}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Discovery Intro & Order / Persona Selector */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: '14px'
                  }}
                >
                  {/* Order Selector */}
                  <div
                    style={{
                      padding: '14px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--bg-canvas)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}
                  >
                    <label
                      htmlFor="crm-order-select"
                      style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}
                    >
                      1. Select Blocked Customer Order (CRM Queue)
                    </label>
                    <select
                      id="crm-order-select"
                      className="select-control"
                      value={selectedRecord.order_id}
                      onChange={(e) => handleSelectOrder(e.target.value)}
                    >
                      {state.erp_records.map((rec) => (
                        <option key={rec.order_id} value={rec.order_id}>
                          {rec.order_id} · {rec.customer_name} ({formatUsd(rec.amount_usd)} ·{' '}
                          {rec.current_status})
                        </option>
                      ))}
                    </select>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                      Credit Limit: <strong>{formatUsd(selectedRecord.credit_limit_usd)}</strong> ·
                      Current Exposure:{' '}
                      <strong>{formatUsd(selectedRecord.current_exposure_usd)}</strong> · Risk Tier:{' '}
                      <strong>{selectedRecord.risk_tier}</strong>
                    </div>
                  </div>

                  {/* Requester Role Selector (with Support Agent Trap) */}
                  <div
                    style={{
                      padding: '14px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--bg-canvas)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      2. Acting Employee Role (Delegated to AI Copilot)
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className={`btn btn-sm ${
                          state.persona === 'erp-operator' ? 'btn-primary' : ''
                        }`}
                        style={{ flex: 1 }}
                        onClick={() => handlePersonaChange('erp-operator')}
                      >
                        <span>Finance Operator (erp-operator)</span>
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${
                          state.persona === 'support-agent' ? 'btn-danger-soft' : ''
                        }`}
                        style={{ flex: 1 }}
                        onClick={() => handlePersonaChange('support-agent')}
                      >
                        <span>Support Agent (RBAC Trap)</span>
                      </button>
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                      {state.persona === 'erp-operator'
                        ? 'Authorized for audit_and_release_credit_hold (subject to >$200.00 HITL-001 gate).'
                        : 'Support Agent trap active: MCP Proxy will deny finance credit release (-32001).'}
                    </div>
                  </div>
                </div>

                {/* AI Copilot Prompt & Step 1 Token Exchange Action */}
                <div className="prompt-sim-box">
                  <div style={{ flex: 1, minWidth: '240px' }}>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        marginBottom: '2px'
                      }}
                    >
                      CRM Copilot Prompt · Cross-Cloud OBO Delegation
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      &ldquo;Audit {selectedRecord.customer_name}&apos;s credit exposure for order{' '}
                      {selectedRecord.order_id} ({formatUsd(selectedRecord.amount_usd)}) and prepare
                      a release recommendation.&rdquo;
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-dark"
                      disabled={animatingHop > 0}
                      onClick={() => runStage1Animated('NONE')}
                    >
                      <KeyRound size={14} />
                      <span>
                        {stage1Done
                          ? 'Re-Issue 15m (900s) Scoped AI Pass'
                          : 'Grant 15m (900s) Scoped AI Access'}
                      </span>
                    </button>

                    {stage1Done && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleRouteToMcpConsole}
                      >
                        <span>Ask AI Copilot to Release Hold (Seat 2)</span>
                        <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Attack Blocked Alert Banner */}
                {tokenBundle?.status === 'ATTACK_BLOCKED' && (
                  <div
                    role="alert"
                    style={{
                      padding: '14px 16px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--accent-crimson-dim)',
                      border: '1px solid var(--accent-crimson-border)',
                      display: 'flex',
                      gap: '10px',
                      alignItems: 'flex-start'
                    }}
                  >
                    <ShieldAlert
                      size={18}
                      color="#dc2626"
                      style={{ flexShrink: 0, marginTop: '2px' }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 700,
                          color: 'var(--accent-crimson-ink)',
                          fontFamily: 'var(--font-mono)'
                        }}
                      >
                        HTTP 403 · {tokenBundle.error_code} (stripped_at_frontdoor:{' '}
                        {String(tokenBundle.inbound_auth0_jwt.stripped_at_frontdoor)})
                      </div>
                      <div style={{ fontSize: '12.5px', color: 'var(--text-primary)' }}>
                        {tokenBundle.error_detail}
                      </div>
                    </div>
                  </div>
                )}

                {/* 3 Live Animated Step 1 Hops (Aligned with 900s TTL & stripped_at_frontdoor) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {([
                    {
                      hop: 1 as const,
                      title:
                        '1. Inbound Auth0 User JWT (stripped_at_frontdoor: true) → Stripped at Cloud Run Frontdoor',
                      desc: 'Raw user bearer token is verified and stripped at the Cloud Run Frontdoor (stripped_at_frontdoor: true) so downstream AI agents can never replay your personal login.',
                      passBadge: 'FRONTDOOR STRIPPED (stripped_at_frontdoor: true)',
                      failBadge: 'BLOCKED AT GATE 1 (stripped_at_frontdoor: false)'
                    },
                    {
                      hop: 2 as const,
                      title:
                        '2. Okta RFC 8693 Issues a 15-Minute (900s) Scoped Pass (oauth-id-jag+jwt)',
                      desc: 'Okta mints a single-purpose 15-Minute (900s) Scoped Pass (expires_in: 900) bound strictly to aud=https://vertex-agent.0trust.dev/oauth/token.',
                      passBadge: '900s PASS ISSUED',
                      failBadge: 'BLOCKED AT GATE 2 (AUDIENCE MISMATCH)'
                    },
                    {
                      hop: 3 as const,
                      title:
                        '3. GCP Vertex AI OIDC → AWS STS AssumeRoleWithWebIdentity (900s Session)',
                      desc: 'AWS IAM verifies accounts.google.com:sub and :aud before issuing a 15-minute (900s) read-only STS session (obo-sarah-chen).',
                      passBadge: 'AWS STS 900s SESSION VERIFIED',
                      failBadge: 'BLOCKED AT GATE 3 (OIDC SUB MISMATCH)'
                    }
                  ]).map((item, idx) => {
                    const s = getStage1HopState(item.hop);
                    return (
                      <React.Fragment key={item.hop}>
                        {idx > 0 && (
                          <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
                            ↓
                          </div>
                        )}
                        <div className={`gate-card ${s}`}>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '8px',
                              flexWrap: 'wrap',
                              marginBottom: '4px'
                            }}
                          >
                            <span style={{ fontSize: '13.5px', fontWeight: 700 }}>
                              {item.title}
                            </span>
                            {s === 'pending' && <span className="badge">WAITING</span>}
                            {s === 'running' && (
                              <span className="badge badge-blue">
                                <Loader2 size={11} /> CHECKING…
                              </span>
                            )}
                            {s === 'passed' && (
                              <span className="badge badge-emerald">✓ {item.passBadge}</span>
                            )}
                            {s === 'blocked' && (
                              <span className="badge badge-crimson">✕ {item.failBadge}</span>
                            )}
                          </div>
                          <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                            {item.desc}
                          </p>
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>

                {/* Step 1 Red-Team Negative Tests (Attacks A, B, C) */}
                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-canvas)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      flexWrap: 'wrap'
                    }}
                  >
                    <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Red-Team Confused-Deputy &amp; Cross-Cloud Federation Traps (Step 1)
                    </span>
                    <span className="badge badge-crimson">Safe-to-Fail Negative Tests</span>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
                      gap: '10px'
                    }}
                  >
                    <button
                      type="button"
                      className="btn btn-danger-soft"
                      disabled={animatingHop > 0}
                      onClick={() => runStage1Animated('RAW_JWT_FORWARD')}
                    >
                      <div>
                        <div style={{ fontSize: '12.5px', fontWeight: 700 }}>
                          Attack A: Forward Raw User JWT
                        </div>
                        <div style={{ fontSize: '11.5px', fontWeight: 400 }}>
                          Bypass frontdoor strip (<code>stripped_at_frontdoor: false</code>)
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      className="btn btn-danger-soft"
                      disabled={animatingHop > 0}
                      onClick={() => runStage1Animated('ID_JAG_WRONG_AUD')}
                    >
                      <div>
                        <div style={{ fontSize: '12.5px', fontWeight: 700 }}>
                          Attack B: Wrong ID-JAG Audience
                        </div>
                        <div style={{ fontSize: '11.5px', fontWeight: 400 }}>
                          Replay 900s ID-JAG token on an unrelated internal service
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      className="btn btn-danger-soft"
                      disabled={animatingHop > 0}
                      onClick={() => runStage1Animated('SPOOF_GCP_SA')}
                    >
                      <div>
                        <div style={{ fontSize: '12.5px', fontWeight: 700 }}>
                          Attack C: Spoof GCP Service Account
                        </div>
                        <div style={{ fontSize: '11.5px', fontWeight: 400 }}>
                          Present untrusted GCP workload <code>sub</code> to AWS STS
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* ==================== SEAT 2: MARCUS THORNE (AI SEC · MCP CONSOLE + POE GATE) ==================== */}
        {activeSeat === 'ai-sec' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <section
              aria-label="Marcus Thorne MCP Policy Proxy and POE Debugger"
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
                  padding: '12px 18px',
                  borderBottom: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-canvas)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <FileCode2 size={16} color="#2563eb" />
                  <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    MCP Policy Proxy &amp; Predict–Observe–Explain (POE) Debugger
                  </span>
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-muted)'
                    }}
                  >
                    marcus.thorne@0trust.dev
                  </span>
                </div>

                <span className="badge badge-blue">
                  Archetype C · Predict → Observe → Explain
                </span>
              </div>

              <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* ARCHETYPE C: PREDICT GATE */}
                <div
                  style={{
                    padding: '16px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--accent-primary-dim)',
                    border: '1px solid var(--accent-primary-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      flexWrap: 'wrap'
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: 'var(--accent-primary-ink)'
                        }}
                      >
                        Phase 2 · Predict–Observe–Explain (POE) Gate
                      </div>
                      <div
                        style={{
                          fontSize: '14px',
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                          marginTop: '2px'
                        }}
                      >
                        Predict: What happens when AI Copilot calls{' '}
                        <code>audit_and_release_credit_hold</code> on{' '}
                        <code>{selectedRecord.order_id}</code> ({formatUsd(selectedRecord.amount_usd)})?
                      </div>
                    </div>
                    <span className="badge badge-blue">
                      {selectedPrediction
                        ? `Selected: Prediction ${selectedPrediction}`
                        : 'Select a Hypothesis'}
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                      gap: '10px'
                    }}
                  >
                    {POE_HYPOTHESES.map((item) => {
                      const isSelected = selectedPrediction === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setSelectedPrediction(item.id)}
                          style={{
                            textAlign: 'left',
                            padding: '12px',
                            borderRadius: 'var(--radius-sm)',
                            border: isSelected
                              ? '2px solid var(--accent-primary)'
                              : '1px solid var(--border-strong)',
                            backgroundColor: isSelected ? '#ffffff' : 'var(--bg-surface)',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px'
                          }}
                        >
                          <div
                            style={{
                              fontSize: '12.5px',
                              fontWeight: 700,
                              color: 'var(--text-primary)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '6px'
                            }}
                          >
                            <span>{item.title}</span>
                            {isSelected && (
                              <span className="badge badge-blue">HYPOTHESIS</span>
                            )}
                          </div>
                          <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                            {item.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* EXPLAIN BANNER (Unlocked once observed) */}
                  {poeObserved && mcpResult && (
                    <div
                      role="status"
                      style={{
                        marginTop: '4px',
                        padding: '12px 14px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor:
                          selectedPrediction === 'B'
                            ? 'var(--accent-emerald-dim)'
                            : 'var(--accent-amber-dim)',
                        border: `1px solid ${
                          selectedPrediction === 'B'
                            ? 'var(--accent-emerald-border)'
                            : 'var(--accent-amber-border)'
                        }`,
                        color:
                          selectedPrediction === 'B'
                            ? 'var(--accent-emerald-ink)'
                            : 'var(--accent-amber-ink)',
                        fontSize: '12.5px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px'
                      }}
                    >
                      <strong>
                        {selectedPrediction === 'B'
                          ? '✓ Explain — Hypothesis Confirmed (Prediction B):'
                          : 'Explain — Observed Outcome vs. Hypothesis:'}
                      </strong>
                      <span>
                        Even with a valid 900s Okta ID-JAG &amp; AWS STS session, the MCP Policy
                        Proxy enforces <code>HITL-001 (amount &gt; $200.00)</code>. High-value credit
                        releases return <code>HTTP 202 PENDING_HUMAN_APPROVAL</code> and route ticket{' '}
                        <code>{mcpResult.hitl_ticket_id || 'HITL-SN-1042'}</code> to Elena Vance in
                        Seat 3. (Low-value adjustments like <code>ORD-1049</code> $180.00 auto-approve
                        under $200.00).
                      </span>
                    </div>
                  )}
                </div>

                {/* OBSERVE GATE: MCP Tool Call Execution Bar */}
                <div className="prompt-sim-box">
                  <div style={{ flex: 1, minWidth: '240px' }}>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        marginBottom: '2px'
                      }}
                    >
                      Observe · JSON-RPC 2.0 tools/call Interceptor
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      <code>tools/call</code> → <code>audit_and_release_credit_hold</code> (
                      <code>{selectedRecord.order_id}</code> · {formatUsd(selectedRecord.amount_usd)}{' '}
                      · persona: <code>{state.persona}</code>)
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-dark"
                      disabled={animatingHop > 0}
                      onClick={() => runStage2Animated('COMPLIANT_AUDIT')}
                    >
                      <Play size={13} />
                      <span>
                        {stage2Done
                          ? 'Re-Run MCP Policy Evaluation'
                          : 'Observe: Run MCP Policy Check'}
                      </span>
                    </button>

                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={animatingHop > 0}
                      onClick={() => runStage2Animated('LOW_VALUE_AUTO')}
                    >
                      <span>Test Low-Value ($180 ≤ $200 Auto-Approve)</span>
                    </button>

                    {mcpResult?.overall_decision === 'ESCALATED_HITL' && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => handleSelectSeat('finance-mgr')}
                      >
                        <span>Review HITL Ticket as Finance Manager (Seat 3)</span>
                        <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Policy Blocked Banner (-32001 / -32002) */}
                {mcpResult &&
                  (mcpResult.overall_decision === 'DENIED_DLP' ||
                    mcpResult.overall_decision === 'DENIED_RBAC') && (
                    <div
                      role="alert"
                      style={{
                        padding: '14px 16px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--accent-crimson-dim)',
                        border: '1px solid var(--accent-crimson-border)',
                        display: 'flex',
                        gap: '10px',
                        alignItems: 'flex-start'
                      }}
                    >
                      <ShieldAlert
                        size={18}
                        color="#dc2626"
                        style={{ flexShrink: 0, marginTop: '2px' }}
                      />
                      <div>
                        <div
                          style={{
                            fontSize: '13px',
                            fontWeight: 700,
                            color: 'var(--accent-crimson-ink)',
                            fontFamily: 'var(--font-mono)'
                          }}
                        >
                          HTTP 403 · MCP Policy Blocked: {mcpResult.overall_decision}
                        </div>
                        <div
                          style={{
                            fontSize: '12.5px',
                            color: 'var(--text-primary)',
                            marginTop: '2px'
                          }}
                        >
                          {mcpResult.dlp_matched_rule
                            ? `JSON-RPC -32002 DLPViolationDetected: Sensitive data pattern matched (${mcpResult.dlp_matched_rule}). Payload halted before reaching LLM or ERP.`
                            : `JSON-RPC -32001 ToolExecutionDenied: Persona '${state.persona}' is not authorized to invoke finance release tools.`}
                        </div>
                      </div>
                    </div>
                  )}

                {/* 3 Animated MCP Guardrail Gates */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {([
                    {
                      gate: 1 as const,
                      title: '1. Role Permission Check (RBAC Allowlist · agent-tool-rbac)',
                      desc: 'Verifies the delegated persona is permitted to invoke the target MCP tool (-32001 ToolExecutionDenied on mismatch).',
                      passBadge: 'ROLE ALLOWED',
                      failBadge: 'ROLE DENIED (-32001)'
                    },
                    {
                      gate: 2 as const,
                      title: '2. Sensitive Data & Secret Scanner (Regex DLP · agent-dlp-rules)',
                      desc: 'Scans outbound tool arguments for raw API bearer tokens (DLP-003), SSNs (DLP-002), and payment cards (DLP-001) (-32002 on leak).',
                      passBadge: 'NO SECRETS FOUND',
                      failBadge: 'SECRET / SSN BLOCKED (-32002)'
                    },
                    {
                      gate: 3 as const,
                      title: '3. High-Value Financial Escalation Gate (HITL-001 · >$200.00)',
                      desc: 'Transactions above $200.00 cannot be autonomously executed by AI—they halt and mint a ServiceNow HITL approval ticket.',
                      passBadge: 'AUTO-APPROVED (≤$200.00)',
                      warnBadge: 'ESCALATED TO SERVICENOW HITL (>$200.00)'
                    }
                  ]).map((item) => {
                    const s = getStage2GateState(item.gate);
                    return (
                      <div key={item.gate} className={`gate-card ${s}`}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '8px',
                            flexWrap: 'wrap',
                            marginBottom: '4px'
                          }}
                        >
                          <span style={{ fontSize: '13.5px', fontWeight: 700 }}>{item.title}</span>
                          {s === 'pending' && <span className="badge">WAITING</span>}
                          {s === 'running' && (
                            <span className="badge badge-blue">
                              <Loader2 size={11} /> SCANNING…
                            </span>
                          )}
                          {s === 'passed' && (
                            <span className="badge badge-emerald">✓ {item.passBadge}</span>
                          )}
                          {s === 'blocked' && (
                            <span className="badge badge-crimson">✕ {item.failBadge}</span>
                          )}
                          {s === 'warning' && (
                            <span className="badge badge-amber">⚠ {item.warnBadge}</span>
                          )}
                        </div>
                        <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                          {item.desc}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {/* Step 2 Red-Team Negative Tests (Attacks D & E) */}
                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-canvas)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      flexWrap: 'wrap'
                    }}
                  >
                    <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Red-Team MCP Policy &amp; Data Exfiltration Traps (Step 2)
                    </span>
                    <span className="badge badge-crimson">JSON-RPC -32001 / -32002</span>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                      gap: '10px'
                    }}
                  >
                    <button
                      type="button"
                      className="btn btn-danger-soft"
                      disabled={animatingHop > 0}
                      onClick={() => runStage2Animated('DLP_SECRET_LEAK')}
                    >
                      <div>
                        <div style={{ fontSize: '12.5px', fontWeight: 700 }}>
                          Attack D: Leak Bearer Token &amp; SSN in Tool Args
                        </div>
                        <div style={{ fontSize: '11.5px', fontWeight: 400 }}>
                          Triggers <code>DLP-003</code> &amp; <code>DLP-002</code> (JSON-RPC{' '}
                          <code>-32002</code>)
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      className="btn btn-danger-soft"
                      disabled={animatingHop > 0}
                      onClick={() => runStage2Animated('RBAC_VIOLATION')}
                    >
                      <div>
                        <div style={{ fontSize: '12.5px', fontWeight: 700 }}>
                          Attack E: Support Agent Calls Privileged ERP Refund
                        </div>
                        <div style={{ fontSize: '11.5px', fontWeight: 400 }}>
                          Triggers <code>agent-tool-rbac</code> deny (JSON-RPC <code>-32001</code>)
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* ==================== SEAT 3: ELENA VANCE (FINANCE MANAGER · APPROVAL QUEUE) ==================== */}
        {activeSeat === 'finance-mgr' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <section
              aria-label="Elena Vance ServiceNow HITL Approval Queue"
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
                  padding: '12px 18px',
                  borderBottom: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-canvas)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <UserCheck size={16} color="#2563eb" />
                  <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    ServiceNow Scoped App (<code>x_ent_erp_ovl</code>) · HITL Approval Queue
                  </span>
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-muted)'
                    }}
                  >
                    elena.vance@0trust.dev
                  </span>
                </div>

                <span
                  className={`badge ${
                    selectedRecord.current_status === 'RELEASED'
                      ? 'badge-emerald'
                      : 'badge-amber'
                  }`}
                >
                  {selectedRecord.current_status === 'RELEASED'
                    ? `Released · ${selectedRecord.order_id}`
                    : `Ticket ${mcpResult?.hitl_ticket_id || 'HITL-SN-1042'} · Awaiting Sign-Off`}
                </span>
              </div>

              <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Order-to-Cash Exception Table */}
                <div className="data-table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Customer</th>
                        <th>Amount</th>
                        <th>Exposure / Limit</th>
                        <th>Status</th>
                        <th>Bedrock SigV4 Advisory</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.erp_records.slice(0, 4).map((rec) => {
                        const isSelected = rec.order_id === selectedRecord.order_id;
                        return (
                          <tr
                            key={rec.order_id}
                            className={`clickable-row ${isSelected ? 'selected-row' : ''}`}
                            onClick={() => handleSelectOrder(rec.order_id)}
                          >
                            <td style={{ fontWeight: 700 }}>{rec.order_id}</td>
                            <td>{rec.customer_name}</td>
                            <td style={{ fontWeight: 600 }}>{formatUsd(rec.amount_usd)}</td>
                            <td style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                              {formatUsd(rec.current_exposure_usd)} /{' '}
                              {formatUsd(rec.credit_limit_usd)}
                            </td>
                            <td>{getStatusBadge(rec.current_status)}</td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled={isAiThinking}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  runStage3AiReview(rec.order_id, false);
                                }}
                              >
                                <Sparkles size={12} />
                                <span>Generate SigV4 Advisory</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* AWS Bedrock Claude 3.5 Advisory Card */}
                <div
                  className={`gate-card ${
                    isAiThinking
                      ? 'running'
                      : bedrockTimeoutTriggered
                        ? 'blocked'
                        : selectedRecord.current_status === 'PROCESSING'
                          ? 'warning'
                          : selectedRecord.current_status === 'RELEASED'
                            ? 'passed'
                            : 'pending'
                  }`}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px',
                      flexWrap: 'wrap',
                      marginBottom: '6px'
                    }}
                  >
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <Sparkles size={14} color="#d97706" />
                      <span>
                        AWS Bedrock Claude 3.5 Sonnet Risk Advisory ({selectedRecord.order_id})
                      </span>
                    </span>
                    <span
                      className={`badge ${
                        bedrockTimeoutTriggered ? 'badge-crimson' : 'badge-amber'
                      }`}
                    >
                      {isAiThinking
                        ? 'INVOKING BEDROCK (SIGV4)…'
                        : bedrockTimeoutTriggered
                          ? 'HTTP 504 TIMEOUT — REVERTED TO BLOCKED'
                          : 'ADVISORY ONLY — CANNOT APPROVE'}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: '12.5px',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.55,
                      whiteSpace: 'pre-line'
                    }}
                  >
                    {isAiThinking
                      ? 'Signing outbound request with ephemeral AWS STS SigV4 headers and evaluating 36-month payment history…'
                      : selectedRecord.ai_justification}
                  </p>
                </div>

                {/* Forged Callback 401 Alert */}
                {forgedCallbackBlocked && (
                  <div
                    role="alert"
                    style={{
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--accent-crimson-dim)',
                      border: '1px solid var(--accent-crimson-border)',
                      color: 'var(--accent-crimson-ink)',
                      fontSize: '12.5px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px'
                    }}
                  >
                    <ShieldAlert size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <strong style={{ fontFamily: 'var(--font-mono)' }}>
                        HTTP 401 · 401_UNAUTHORIZED_CALLBACK_REJECTED
                      </strong>
                      <div>
                        Constant-time comparison on <code>X-Agent-Callback-Token</code> failed on{' '}
                        <code>POST /api/x_ent_erp_ovl/v1/agent-callback</code>. Order{' '}
                        <code>{selectedRecord.order_id}</code> remains safely locked in{' '}
                        <code>{selectedRecord.current_status}</code>.
                      </div>
                    </div>
                  </div>
                )}

                {/* Human Manager Decision Box */}
                <div
                  style={{
                    padding: '16px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-canvas)',
                    border: '1.5px solid var(--border-strong)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      flexWrap: 'wrap'
                    }}
                  >
                    <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Human Finance Manager Sign-Off (Authenticated HITL Callback)
                    </span>
                    <code style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      POST /api/x_ent_erp_ovl/v1/agent-callback
                    </code>
                  </div>

                  <div>
                    <label
                      htmlFor="justification-select"
                      style={{
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--text-secondary)',
                        marginBottom: '4px'
                      }}
                    >
                      Controller Approval / Denial Justification:
                    </label>
                    <select
                      id="justification-select"
                      className="select-control"
                      value={justification}
                      onChange={(e) => setJustification(e.target.value)}
                    >
                      {JUSTIFICATION_TEMPLATES.map((tpl) => (
                        <option key={tpl} value={tpl}>
                          {tpl}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-emerald"
                      disabled={isCallbackSubmitting}
                      onClick={() =>
                        void runStage3HitlDecision(
                          selectedRecord.order_id,
                          'APPROVED',
                          justification,
                          true
                        )
                      }
                    >
                      <ShieldCheck size={14} />
                      <span>✓ Approve &amp; Release Order ({selectedRecord.order_id})</span>
                    </button>

                    <button
                      type="button"
                      className="btn"
                      disabled={isCallbackSubmitting}
                      onClick={() =>
                        void runStage3HitlDecision(
                          selectedRecord.order_id,
                          'DENIED',
                          justification,
                          true
                        )
                      }
                    >
                      <XCircle size={14} />
                      <span>✕ Deny &amp; Keep Blocked</span>
                    </button>
                  </div>
                </div>

                {/* Step 3 Failure & Tampering Safeguards (Tests F & G) */}
                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-canvas)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      flexWrap: 'wrap'
                    }}
                  >
                    <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Red-Team Fail-Safe &amp; Callback Tampering Tests (Step 3)
                    </span>
                    <span className="badge badge-crimson">Invariants 1 &amp; 3</span>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                      gap: '10px'
                    }}
                  >
                    <button
                      type="button"
                      className="btn btn-danger-soft"
                      disabled={isAiThinking}
                      onClick={() => runStage3AiReview(selectedRecord.order_id, true)}
                    >
                      <div>
                        <div style={{ fontSize: '12.5px', fontWeight: 700 }}>
                          Test F: Simulate AWS Bedrock 504 Timeout
                        </div>
                        <div style={{ fontSize: '11.5px', fontWeight: 400 }}>
                          Verifies fail-safe rollback from <code>PROCESSING</code> to{' '}
                          <code>BLOCKED</code>
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      className="btn btn-danger-soft"
                      disabled={isCallbackSubmitting}
                      onClick={() =>
                        void runStage3HitlDecision(
                          selectedRecord.order_id,
                          'APPROVED',
                          'Attempted unauthenticated approval',
                          false
                        )
                      }
                    >
                      <div>
                        <div style={{ fontSize: '12.5px', fontWeight: 700 }}>
                          Test G: Forge Manager Approval Callback
                        </div>
                        <div style={{ fontSize: '11.5px', fontWeight: 400 }}>
                          Fails constant-time <code>X-Agent-Callback-Token</code> verification (
                          <code>HTTP 401</code>)
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* ==================== PHASE 4: REFLECTION DEBRIEF CARD ==================== */}
        {showReflectionDebrief && (
          <section
            aria-label="Phase 4 Reflection Debrief"
            style={{
              marginTop: '14px',
              backgroundColor: 'var(--bg-surface)',
              border: '1.5px solid var(--accent-emerald)',
              borderRadius: 'var(--radius-lg)',
              padding: '18px 20px',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                flexWrap: 'wrap'
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--accent-emerald)'
                  }}
                >
                  Phase 4 · Reflection Debrief
                </div>
                <h2 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {stage3Done
                    ? `Order ${selectedRecord.order_id} Released Safely Under Dual Identity, MCP & Human Controls`
                    : 'Zero-Trust Agentic Financial Guardrails Verified'}
                </h2>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm" onClick={handleFullReset}>
                  <RotateCcw size={12} />
                  <span>Restart Lab</span>
                </button>
                <button type="button" className="btn btn-dark btn-sm" onClick={onBackHome}>
                  <span>← All Labs</span>
                </button>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '10px'
              }}
            >
              <div
                style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-canvas)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '12px'
                }}
              >
                <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--text-primary)' }}>
                  1. Frontdoor JWT Strip &amp; 900s ID-JAG
                </strong>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Inbound Auth0 user JWTs are stripped at the frontdoor (
                  <code>stripped_at_frontdoor: true</code>) and exchanged for a 15-minute (
                  <code>900s</code>) Okta <code>oauth-id-jag+jwt</code> pass and GCP→AWS STS session.
                </span>
              </div>

              <div
                style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-canvas)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '12px'
                }}
              >
                <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--text-primary)' }}>
                  2. Deterministic MCP Policy Proxy
                </strong>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Every <code>tools/call</code> payload is checked against persona RBAC (
                  <code>-32001</code>), regex secret/PII DLP (<code>-32002</code>), and{' '}
                  <code>HITL-001 (&gt;$200.00)</code> before execution.
                </span>
              </div>

              <div
                style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-canvas)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '12px'
                }}
              >
                <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--text-primary)' }}>
                  3. SigV4 Advisory &amp; Constant-Time HITL
                </strong>
                <span style={{ color: 'var(--text-secondary)' }}>
                  AWS Bedrock writes an advisory note in <code>PROCESSING</code> (with 504 fail-safe
                  rollback); only a constant-time verified <code>X-Agent-Callback-Token</code> sets{' '}
                  <code>RELEASED</code>.
                </span>
              </div>
            </div>

            <div
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-canvas)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                Security Traps &amp; POE Hypotheses Explored ({exploredTrapCount} /{' '}
                {trapChecklist.length})
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: '6px',
                  fontSize: '12px'
                }}
              >
                {trapChecklist.map((trap) => (
                  <div
                    key={trap.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '7px',
                      color: trap.tested ? 'var(--accent-emerald-ink)' : 'var(--text-muted)'
                    }}
                  >
                    <CheckCircle2
                      size={14}
                      color={trap.tested ? '#059669' : '#cbd5e1'}
                      style={{ flexShrink: 0 }}
                    />
                    <span>{trap.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                Open the sticky <strong>X-Ray Telemetry Drawer</strong> below to inspect live W3C{' '}
                <code>traceparent</code> spans, 900s ID-JAG claims, MCP JSON-RPC responses, and AWS
                SigV4 headers.
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Sticky Bottom X-Ray Telemetry Drawer (Universal Invariant 4) */}
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
