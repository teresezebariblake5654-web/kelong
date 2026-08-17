import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type {
  ExecuteWorkflowRequest,
  ExecuteWorkflowResult,
  WorkflowDefinition,
  WorkflowExceptionSummary,
} from '@aw/shared';
import { requireWorkflowDefinition, WORKFLOW_CATALOG_VERSION } from '@aw/task-templates';
import { LocalDataEngine } from '../engine.js';
import type { DataRow } from '../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from './exporters/XlsxResultExporter.js';
import { OperatorRegistry } from './OperatorRegistry.js';
import { registerBuiltinOperators } from './operators/registerBuiltin.js';
import type { PersistedRuleStore } from './rules/FileRuleStore.js';
import { createRuleStore, type RuleStore } from './rules/RuleStore.js';
import { sha256Buffer } from './SourceTrace.js';
import type { NormalizedDataset, OperatorContext, WorkflowHandler } from './types.js';
import { executeProdConsumptionCheck } from './workflows/prodConsumptionCheck.js';
import { executeProdMaterialDaily } from './workflows/prodMaterialDaily.js';
import { executeProdPlanClean } from './workflows/prodPlanClean.js';
import { executeProdProgress } from './workflows/prodProgress.js';
import { executeProdQuality } from './workflows/prodQuality.js';
import { executeProdDowntimeClose } from './workflows/prodDowntimeClose.js';
import { executeHrPayroll } from './workflows/hrPayroll.js';
import { executeHrAttendance } from './workflows/hrAttendance.js';
import { executeHrEmployeeFile } from './workflows/hrEmployeeFile.js';
import { executeHrOnboardOffboard } from './workflows/hrOnboardOffboard.js';
import { executeHrSocialInsurance } from './workflows/hrSocialInsurance.js';
import { executeHrRecruitmentFunnel } from './workflows/hrRecruitmentFunnel.js';
import { executeHrPerformanceDistribution } from './workflows/hrPerformanceDistribution.js';
import { executeFinExpenseClean } from './workflows/finExpenseClean.js';
import { executeFinReconciliation } from './workflows/finReconciliation.js';
import { executeFinArap } from './workflows/finArap.js';
import { executeFinInvoiceOcr } from './workflows/finInvoiceOcr.js';
import { executeFinOperatingSummary } from './workflows/finOperatingSummary.js';
import { executeEcomOrderClean } from './workflows/ecomOrderClean.js';
import { executeEcomRefund } from './workflows/ecomRefund.js';
import { executeEcomProductData } from './workflows/ecomProductData.js';
import { executeEcomLiveOrder } from './workflows/ecomLiveOrder.js';
import { executeEcomSalesSummary } from './workflows/ecomSalesSummary.js';
import { executeLogInventoryCount } from './workflows/logInventoryCount.js';
import { executeLogInoutReconcile } from './workflows/logInoutReconcile.js';
import { executeLogShipmentTrack } from './workflows/logShipmentTrack.js';
import { executeLogStockAlert } from './workflows/logStockAlert.js';
import { executeLogTransferClean } from './workflows/logTransferClean.js';
import { executeAdminAssetInventory } from './workflows/adminAssetInventory.js';
import { executeAdminExpenseAnalysis } from './workflows/adminExpenseAnalysis.js';
import { executeAdminRoomUtilization } from './workflows/adminRoomUtilization.js';
import { executeAdminContractExpiry } from './workflows/adminContractExpiry.js';
export type WorkflowRuntimeOptions = {
  engine?: LocalDataEngine;
  ruleStore?: RuleStore;
  persistedRuleStore?: PersistedRuleStore;
  operators?: OperatorRegistry;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function summarizeExceptions(
  exceptions: OperatorContext['exceptions'],
): WorkflowExceptionSummary[] {
  const counts = new Map<string, WorkflowExceptionSummary>();
  for (const item of exceptions) {
    const existing = counts.get(item.code);
    if (existing) {
      existing.count += 1;
      continue;
    }
    counts.set(item.code, {
      code: item.code,
      severity: item.severity,
      count: 1,
      message: item.message,
    });
  }
  return [...counts.values()];
}

export class WorkflowRuntime {
  private readonly engine: LocalDataEngine;
  private readonly ruleStore: RuleStore;
  private readonly persistedRuleStore?: PersistedRuleStore;
  private readonly operators: OperatorRegistry;
  private readonly handlers = new Map<string, WorkflowHandler>();

  constructor(options: WorkflowRuntimeOptions = {}) {
    this.engine = options.engine ?? new LocalDataEngine();
    this.ruleStore = options.ruleStore ?? createRuleStore();
    this.persistedRuleStore = options.persistedRuleStore;
    this.operators = options.operators ?? new OperatorRegistry();
    if (this.operators.list().length === 0) {
      registerBuiltinOperators(this.operators);
    }
    this.handlers.set('PROD-MATERIAL-DAILY-001', executeProdMaterialDaily);
    this.handlers.set('PROD-CONSUMPTION-CHECK-002', executeProdConsumptionCheck);
    this.handlers.set('PROD-PLAN-CLEAN-003', executeProdPlanClean);
    this.handlers.set('PROD-PROGRESS-004', executeProdProgress);
    this.handlers.set('PROD-QUALITY-005', executeProdQuality);
    this.handlers.set('PROD-DOWNTIME-CLOSE-006', executeProdDowntimeClose);
    this.handlers.set('HR-PAYROLL-001', executeHrPayroll);
    this.handlers.set('HR-ATTENDANCE-002', executeHrAttendance);
    this.handlers.set('HR-EMPLOYEE-FILE-003', executeHrEmployeeFile);
    this.handlers.set('HR-ONBOARD-OFFBOARD-004', executeHrOnboardOffboard);
    this.handlers.set('HR-SOCIAL-INSURANCE-005', executeHrSocialInsurance);
    this.handlers.set('HR-RECRUITMENT-FUNNEL-006', executeHrRecruitmentFunnel);
    this.handlers.set('HR-PERFORMANCE-DISTRIBUTION-007', executeHrPerformanceDistribution);
    this.handlers.set('FIN-EXPENSE-CLEAN-001', executeFinExpenseClean);
    this.handlers.set('FIN-RECONCILIATION-002', executeFinReconciliation);
    this.handlers.set('FIN-ARAP-003', executeFinArap);
    this.handlers.set('FIN-INVOICE-OCR-004', executeFinInvoiceOcr);
    this.handlers.set('FIN-OPERATING-SUMMARY-005', executeFinOperatingSummary);
    this.handlers.set('ECOM-ORDER-CLEAN-001', executeEcomOrderClean);
    this.handlers.set('ECOM-REFUND-002', executeEcomRefund);
    this.handlers.set('ECOM-PRODUCT-DATA-003', executeEcomProductData);
    this.handlers.set('ECOM-LIVE-ORDER-004', executeEcomLiveOrder);
    this.handlers.set('ECOM-SALES-SUMMARY-005', executeEcomSalesSummary);
    this.handlers.set('ADMIN-ASSET-INVENTORY-001', executeAdminAssetInventory);
    this.handlers.set('ADMIN-EXPENSE-ANALYSIS-002', executeAdminExpenseAnalysis);
    this.handlers.set('ADMIN-ROOM-UTILIZATION-003', executeAdminRoomUtilization);
    this.handlers.set('ADMIN-CONTRACT-EXPIRY-004', executeAdminContractExpiry);
    this.handlers.set('LOG-INVENTORY-COUNT-001', executeLogInventoryCount);
    this.handlers.set('LOG-INOUT-RECONCILE-002', executeLogInoutReconcile);
    this.handlers.set('LOG-SHIPMENT-TRACK-003', executeLogShipmentTrack);
    this.handlers.set('LOG-STOCK-ALERT-004', executeLogStockAlert);
    this.handlers.set('LOG-TRANSFER-CLEAN-005', executeLogTransferClean);
  }

  getOperatorRegistry(): OperatorRegistry {
    return this.operators;
  }

  getRuleStore(): RuleStore {
    return this.ruleStore;
  }

  getPersistedRuleStore(): PersistedRuleStore | undefined {
    return this.persistedRuleStore;
  }

  registerHandler(workflowId: string, handler: WorkflowHandler): void {
    this.handlers.set(workflowId, handler);
  }

  async execute(request: ExecuteWorkflowRequest): Promise<ExecuteWorkflowResult> {
    const definition = requireWorkflowDefinition(request.workflowId);
    const handler = this.handlers.get(request.workflowId);
    if (!handler) {
      return {
        runId: randomUUID(),
        workflowId: request.workflowId,
        workflowVersion: `${definition.id}@${WORKFLOW_CATALOG_VERSION}`,
        status: 'FAILED',
        outputFiles: [],
        metrics: {},
        exceptions: [],
        errorMessage: `No local handler registered for workflow ${request.workflowId}`,
      };
    }

    const runId = randomUUID();
    const runDate = request.runDate ?? todayIsoDate();

    let persisted: Record<string, unknown> = {};
    if (this.persistedRuleStore && request.companyId) {
      persisted = await this.persistedRuleStore.getWorkflowRules(
        request.companyId,
        request.workflowId,
      );
    }

    const companyRules = this.ruleStore.resolve(
      request.workflowId,
      request.companyRules,
      request.answers,
      {
        persisted,
        rules: request.rules,
      },
    );

    const ctx: OperatorContext = {
      definition,
      request,
      companyRules,
      runId,
      runDate,
      workflowVersion: `${definition.id}@${WORKFLOW_CATALOG_VERSION}`,
      datasets: new Map(),
      resultTables: new Map(),
      exceptions: [],
      metrics: {},
      traces: [],
      inputSha256ByRole: new Map(),
    };

    try {
      await this.loadInputDatasets(ctx, definition);
      return await handler(ctx, definition);
    } catch (error) {
      return {
        runId,
        workflowId: request.workflowId,
        workflowVersion: ctx.workflowVersion,
        status: 'FAILED',
        outputFiles: [],
        metrics: ctx.metrics,
        exceptions: summarizeExceptions(ctx.exceptions),
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async loadInputDatasets(
    ctx: OperatorContext,
    definition: WorkflowDefinition,
  ): Promise<void> {
    for (const roleSpec of definition.inputRoles) {
      const files = ctx.request.inputFiles.filter((file) => file.role === roleSpec.role);
      if (files.length === 0) {
        if (roleSpec.required) {
          throw new Error(`Missing required input role: ${roleSpec.role}`);
        }
        continue;
      }

      const mergedRows: DataRow[] = [];
      let headers: string[] = [];
      let primarySheetName = 'Sheet1';
      let primaryWorkbook = null as ReturnType<LocalDataEngine['parseFile']> | null;
      const shaParts: string[] = [];
      const fileNames: string[] = [];

      for (const file of files) {
        const buffer =
          file.bytes && file.bytes.byteLength > 0
            ? Buffer.from(file.bytes)
            : readFileSync(file.path);
        const sha256 = file.sha256 ?? sha256Buffer(buffer);
        shaParts.push(sha256);
        const displayName = file.originalName || basename(file.path);
        fileNames.push(displayName);
        const workbook = this.engine.parseFile(buffer, displayName);
        const sheet = workbook.sheets[0];
        if (!sheet) {
          throw new Error(`No sheet found in ${displayName}`);
        }
        const cleaned = this.engine.cleanData(sheet, {
          dropEmptyRows: true,
          trimStrings: true,
        });
        if (!primaryWorkbook) {
          primaryWorkbook = workbook;
          primarySheetName = cleaned.sheet.name;
          headers = cleaned.sheet.headers;
        }
        for (const row of cleaned.sheet.rows) {
          mergedRows.push({
            ...row,
            _sourceFile: displayName,
            _sourceSheet: cleaned.sheet.name,
            _inputSha256: sha256,
          });
        }
      }

      const combinedSha =
        shaParts.length === 1 ? shaParts[0]! : sha256Buffer(Buffer.from(shaParts.join('|')));
      ctx.inputSha256ByRole.set(roleSpec.role, combinedSha);

      const dataset: NormalizedDataset = {
        role: roleSpec.role,
        fileName: fileNames.join('+'),
        filePath: files[0]!.path,
        sha256: combinedSha,
        sheetName: primarySheetName,
        rows: mergedRows,
        headers,
        workbook: primaryWorkbook!,
        sheet: primaryWorkbook!.sheets[0]!,
      };
      ctx.datasets.set(roleSpec.role, dataset);
      ctx.resultTables.set(roleSpec.role, dataset.rows);
    }
  }
}

export function createWorkflowRuntime(options?: WorkflowRuntimeOptions): WorkflowRuntime {
  return new WorkflowRuntime(options);
}

export async function executeWorkflow(
  request: ExecuteWorkflowRequest,
  options?: WorkflowRuntimeOptions,
): Promise<ExecuteWorkflowResult> {
  return createWorkflowRuntime(options).execute(request);
}

export function writeSheets(input: {
  definition: WorkflowDefinition;
  outputDir: string;
  runDate: string;
  sheets: Array<{ name: string; rows: DataRow[] }>;
}): string {
  const fileName = renderFileNameTemplate(input.definition.output.fileNameTemplate, {
    runDate: input.runDate,
  });
  return exportResultWorkbook({
    outputDir: input.outputDir,
    fileName,
    sheets: input.sheets,
  });
}
