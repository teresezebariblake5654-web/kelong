import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { isFeatureEnabled, type FeatureFlag } from '../config/featureFlags';
import { useWorkflow } from '../state/workflow';
import { workflowCanEnter, type WorkflowSession, type WorkflowStepKey } from '../state/workflowSession';

const STEP_FALLBACK: Partial<Record<WorkflowStepKey, string>> = {
  task: '/roles',
  import: '/tasks',
  sheet: '/import',
  mapping: '/sheet',
  clean: '/mapping',
  anomalies: '/clean',
  progress: '/anomalies',
  report: '/progress',
};

function resolveFallback(step: WorkflowStepKey, state: WorkflowSession): string {
  if (step === 'progress' && state.importMode === 'document') {
    return '/import';
  }
  if (step === 'report' && state.importMode === 'document') {
    return '/progress';
  }
  return STEP_FALLBACK[step] ?? '/roles';
}

type WorkflowGuardProps = {
  step: WorkflowStepKey;
  children: ReactNode;
};

export function WorkflowGuard({ step, children }: WorkflowGuardProps) {
  const { state } = useWorkflow();
  if (!workflowCanEnter(step, state)) {
    return <Navigate to={resolveFallback(step, state)} replace />;
  }
  return children;
}

type FeatureGuardProps = {
  flag: FeatureFlag;
  featureName: string;
  children: ReactNode;
};

export function FeatureGuard({ flag, children }: FeatureGuardProps) {
  if (!isFeatureEnabled(flag)) {
    return <Navigate to="/chat" replace />;
  }
  return children;
}
