import { createContext, useContext, type ReactNode } from 'react';
import type { HealthCheckResult } from '@workstation/services/workstationApi';

export type WorkstationBackendContextValue = {
  health: HealthCheckResult | null;
  refresh: () => void;
};

const WorkstationBackendContext = createContext<WorkstationBackendContextValue>({
  health: null,
  refresh: () => undefined,
});

export function WorkstationBackendProvider({
  value,
  children,
}: {
  value: WorkstationBackendContextValue;
  children: ReactNode;
}) {
  return (
    <WorkstationBackendContext.Provider value={value}>{children}</WorkstationBackendContext.Provider>
  );
}

export function useWorkstationBackend(): WorkstationBackendContextValue {
  return useContext(WorkstationBackendContext);
}
