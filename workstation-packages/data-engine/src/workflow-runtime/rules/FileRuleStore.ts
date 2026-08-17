import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const RULE_STORE_SCHEMA_VERSION = '1.0';

export type CompanyRulesDocument = {
  schemaVersion: string;
  companyId: string;
  updatedAt: string;
  workflows: Record<string, Record<string, unknown>>;
};

export type PersistedRuleStore = {
  load(companyId: string): Promise<Record<string, unknown>>;
  save(companyId: string, rules: Record<string, unknown>): Promise<void>;
  loadDocument(companyId: string): Promise<CompanyRulesDocument | null>;
  saveWorkflowRules(
    companyId: string,
    workflowId: string,
    rules: Record<string, unknown>,
  ): Promise<CompanyRulesDocument>;
  getWorkflowRules(companyId: string, workflowId: string): Promise<Record<string, unknown>>;
};

function safeCompanyFileName(companyId: string): string {
  return companyId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'company';
}

function emptyDocument(companyId: string): CompanyRulesDocument {
  return {
    schemaVersion: RULE_STORE_SCHEMA_VERSION,
    companyId,
    updatedAt: new Date().toISOString(),
    workflows: {},
  };
}

function assertDocument(value: unknown, companyId: string): CompanyRulesDocument {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid company rules document');
  }
  const doc = value as CompanyRulesDocument;
  if (doc.schemaVersion !== RULE_STORE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported rules schemaVersion: ${String(doc.schemaVersion)} (expected ${RULE_STORE_SCHEMA_VERSION})`,
    );
  }
  if (!doc.workflows || typeof doc.workflows !== 'object') {
    throw new Error('Company rules document missing workflows map');
  }
  return {
    schemaVersion: doc.schemaVersion,
    companyId: doc.companyId || companyId,
    updatedAt: doc.updatedAt || new Date().toISOString(),
    workflows: { ...doc.workflows },
  };
}

function atomicWriteJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(tempPath, filePath);
}

/**
 * Local JSON rule persistence. Caller supplies rootDir (e.g. USB workspace).
 * Does not hardcode C: or Tauri paths. Never stores Excel or business detail rows.
 */
export function createFileRuleStore(options: { rootDir: string }): PersistedRuleStore {
  const rootDir = options.rootDir;

  function filePathFor(companyId: string): string {
    return join(rootDir, 'company-rules', `${safeCompanyFileName(companyId)}.json`);
  }

  async function loadDocument(companyId: string): Promise<CompanyRulesDocument | null> {
    const path = filePathFor(companyId);
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return assertDocument(raw, companyId);
  }

  return {
    async load(companyId: string): Promise<Record<string, unknown>> {
      const doc = await loadDocument(companyId);
      if (!doc) return {};
      return {
        schemaVersion: doc.schemaVersion,
        companyId: doc.companyId,
        updatedAt: doc.updatedAt,
        workflows: doc.workflows,
      };
    },

    async save(companyId: string, rules: Record<string, unknown>): Promise<void> {
      // Accept either a full document-like payload or { workflows: {...} }.
      const incomingWorkflows =
        (rules.workflows as Record<string, Record<string, unknown>> | undefined) ??
        (Object.keys(rules).some((key) => key.startsWith('PROD-') || key.startsWith('HR-') || key.startsWith('FIN-') || key.startsWith('ECOM-') || key.startsWith('ADMIN-') || key.startsWith('LOG-'))
          ? (rules as Record<string, Record<string, unknown>>)
          : undefined);

      const existing = (await loadDocument(companyId)) ?? emptyDocument(companyId);
      const next: CompanyRulesDocument = {
        schemaVersion: RULE_STORE_SCHEMA_VERSION,
        companyId,
        updatedAt: new Date().toISOString(),
        workflows: {
          ...existing.workflows,
          ...(incomingWorkflows ?? {}),
        },
      };
      if (rules.schemaVersion && rules.schemaVersion !== RULE_STORE_SCHEMA_VERSION) {
        throw new Error(`Unsupported rules schemaVersion: ${String(rules.schemaVersion)}`);
      }
      atomicWriteJson(filePathFor(companyId), next);
    },

    loadDocument,

    async saveWorkflowRules(companyId, workflowId, workflowRules) {
      const existing = (await loadDocument(companyId)) ?? emptyDocument(companyId);
      const next: CompanyRulesDocument = {
        schemaVersion: RULE_STORE_SCHEMA_VERSION,
        companyId,
        updatedAt: new Date().toISOString(),
        workflows: {
          ...existing.workflows,
          [workflowId]: { ...workflowRules },
        },
      };
      atomicWriteJson(filePathFor(companyId), next);
      return next;
    },

    async getWorkflowRules(companyId, workflowId) {
      const doc = await loadDocument(companyId);
      return { ...(doc?.workflows?.[workflowId] ?? {}) };
    },
  };
}
