import React, { useState } from 'react';
import { PlaygroundState } from './types';
import {
  loadPlaygroundState,
  resetToCanonicalSeed,
  savePlaygroundState
} from './engine/simulationEngine';
import { AgenticTransactionPage } from './pages/AgenticTransactionPage';
import { LabLeaseGuard } from './shell';

export default function App() {
  const [playgroundState, setPlaygroundState] = useState<PlaygroundState>(() =>
    loadPlaygroundState()
  );

  const handleStateChange = (nextState: PlaygroundState) => {
    setPlaygroundState(nextState);
    savePlaygroundState(nextState);
  };

  const handleReset = () => {
    const fresh = resetToCanonicalSeed('MANUAL_RESET');
    setPlaygroundState(fresh);
    savePlaygroundState(fresh);
  };

  const handleBackHome = () => {
    window.location.href =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:5173/'
        : 'https://0trust.dev/';
  };

  return (
    <LabLeaseGuard labSlug="agentic-transaction" labTitle="Controlled AI Financial Actions">
      <AgenticTransactionPage
        state={playgroundState}
        onChangeState={handleStateChange}
        onBackHome={handleBackHome}
        onResetLab={handleReset}
      />
    </LabLeaseGuard>
  );
}
