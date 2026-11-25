import type { Hono } from 'hono';
import type { AgenticTransactionEnv } from '../functions/api/agentic-transaction/_shared';
import { onRequestPost as approvePost } from '../functions/api/agentic-transaction/approve';
import { onRequestPost as exchangePost } from '../functions/api/agentic-transaction/exchange';
import { onRequestPost as executePost } from '../functions/api/agentic-transaction/execute';
import {
  onRequestGet as stateGet,
  onRequestPost as statePost
} from '../functions/api/agentic-transaction/state';
import type { KVNamespace } from './kvAdapter';
import { createBaseLabApp, type BaseCloudRunEnv } from './runtime';

export { verifyRouterSecret } from './runtime';

export interface CloudRunEnv extends AgenticTransactionEnv, BaseCloudRunEnv {}

export function createCloudRunApp(options?: {
  env?: CloudRunEnv;
  kv?: KVNamespace;
}): Hono {
  return createBaseLabApp<CloudRunEnv>({
    labSlug: 'agentic-transaction',
    env: options?.env,
    kv: options?.kv,
    extraEnv: {
      SN_AGENT_CALLBACK_TOKEN: process.env.SN_AGENT_CALLBACK_TOKEN
    },
    registerRoutes: (app, wrap) => {
      app.get('/api/agentic-transaction/state', wrap(stateGet));
      app.post('/api/agentic-transaction/state', wrap(statePost));
      app.post('/api/agentic-transaction/exchange', wrap(exchangePost));
      app.post('/api/agentic-transaction/execute', wrap(executePost));
      app.post('/api/agentic-transaction/approve', wrap(approvePost));
    }
  });
}
