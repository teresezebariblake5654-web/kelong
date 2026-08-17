import type { LocalWorkspaceConfig } from './types';

const STORAGE_KEY = 'aw.desktop.localWorkspace.v1';
const RULES_PREFIX = 'aw.desktop.companyRules.v1:';

export const DEFAULT_BROWSER_WORKSPACE: LocalWorkspaceConfig = {
  rootDir: 'browser-workspace',
  companyId: 'dev-company',
};

export function loadWorkspaceConfig(): LocalWorkspaceConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BROWSER_WORKSPACE };
    const parsed = JSON.parse(raw) as LocalWorkspaceConfig;
    if (!parsed.rootDir || !parsed.companyId) return { ...DEFAULT_BROWSER_WORKSPACE };
    return parsed;
  } catch {
    return { ...DEFAULT_BROWSER_WORKSPACE };
  }
}

export function saveWorkspaceConfig(config: LocalWorkspaceConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function loadCompanyRulesDocument(companyId: string): Record<string, Record<string, unknown>> {
  try {
    const raw = localStorage.getItem(`${RULES_PREFIX}${companyId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { workflows?: Record<string, Record<string, unknown>> };
    return parsed.workflows ?? {};
  } catch {
    return {};
  }
}

export function saveCompanyWorkflowRules(
  companyId: string,
  workflowId: string,
  rules: Record<string, unknown>,
): void {
  const workflows = loadCompanyRulesDocument(companyId);
  workflows[workflowId] = rules;
  localStorage.setItem(
    `${RULES_PREFIX}${companyId}`,
    JSON.stringify({
      schemaVersion: '1.0',
      companyId,
      updatedAt: new Date().toISOString(),
      workflows,
    }),
  );
}

export function clearCompanyWorkflowRules(companyId: string, workflowId: string): void {
  const workflows = loadCompanyRulesDocument(companyId);
  delete workflows[workflowId];
  localStorage.setItem(
    `${RULES_PREFIX}${companyId}`,
    JSON.stringify({
      schemaVersion: '1.0',
      companyId,
      updatedAt: new Date().toISOString(),
      workflows,
    }),
  );
}
