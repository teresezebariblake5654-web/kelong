import {
  applyExceptionActionsAndRecompute,
  buildFiveDeliverables,
  DEFAULT_ENTERPRISE_RULES,
  loadOrDefaultRules,
  runMaterialDailyCloseWorkflow,
  type AppliedExceptionAction,
  type LocalHistoryStore,
  type MaterialDailyCloseWorkflowResult,
} from './material-daily-close/index.js';
import {
  TEMPLATE_CODE_BY_WORKFLOW,
  type ProductionWorkflowCode,
} from './codes.js';
import {
  buildMaterialVarianceDeliverables,
  runMaterialVarianceClose,
} from './material-variance-close/index.js';
import {
  buildProductionPlanDeliverables,
  runProductionPlanClose,
} from './production-plan-close/index.js';
import {
  buildOutputAttainmentDeliverables,
  runOutputAttainmentClose,
} from './output-attainment-close/index.js';
import {
  buildQualityExceptionDeliverables,
  runQualityExceptionClose,
} from './quality-exception-close/index.js';
import {
  buildDowntimeLossDeliverables,
  runDowntimeLossClose,
} from './downtime-loss-close/index.js';
import type {
  AppliedProductionAction,
  ProductionDeliverable,
  ProductionInputSlot,
  ProductionWorkflowResult,
  RunProductionWorkflowInput,
} from './shared/types.js';

export type AiAllowedOperation =
  | 'FIELD_RECOGNITION'
  | 'REMARK_CLASSIFICATION'
  | 'EXCEPTION_EXPLANATION'
  | 'DOWNTIME_REASON_CLASSIFICATION'
  | 'QUALITY_TEXT_CLASSIFICATION';

export type ProductionWorkflowDefinition = {
  taskCode: ProductionWorkflowCode;
  templateCode: string;
  name: string;
  description: string;
  requiredInputs: ProductionInputSlot[];
  optionalInputs: ProductionInputSlot[];
  fieldDictionary: string[];
  ruleEngine: string;
  exceptionDefinitions: string[];
  aiAllowedOperations: AiAllowedOperation[];
  deliverables: string[];
  enabled: boolean;
  version: string;
  run: (input: RunProductionWorkflowInput & { historyStore?: LocalHistoryStore; scopeKey?: string }) => ProductionWorkflowResult;
  buildDeliverables: (result: ProductionWorkflowResult) => ProductionDeliverable[];
  applyActions?: (
    result: ProductionWorkflowResult,
    actions: AppliedProductionAction[],
  ) => ProductionWorkflowResult;
};

function adaptMaterialDailyClose(
  input: RunProductionWorkflowInput & { historyStore?: LocalHistoryStore; scopeKey?: string },
): ProductionWorkflowResult {
  const raw = runMaterialDailyCloseWorkflow({
    workbooks: input.workbooks,
    answers: input.answers,
    historyStore: input.historyStore,
    scopeKey: input.scopeKey ?? 'production',
  });

  let result: MaterialDailyCloseWorkflowResult = raw;
  if (input.actions?.length) {
    const mapped: AppliedExceptionAction[] = input.actions.map((a) => ({
      exceptionKey: a.exceptionKey,
      code: a.code,
      materialCode: a.materialCode,
      action:
        a.action === 'confirm'
          ? 'confirm_scrap'
          : a.action === 'select_option'
            ? 'select_unit'
            : (a.action as AppliedExceptionAction['action']),
      value: a.value,
      resolvedAt: a.resolvedAt,
    }));
    result = applyExceptionActionsAndRecompute({
      result,
      actions: mapped,
      rules: input.historyStore
        ? loadOrDefaultRules(input.historyStore, input.scopeKey ?? 'production')
        : DEFAULT_ENTERPRISE_RULES,
    });
  }

  return {
    taskCode: 'material_daily_close',
    generatedAt: result.generatedAt,
    blocked: result.blocked,
    clarifications: result.clarifications.map((c) => ({
      id: c.id,
      message: c.message,
      options: c.options,
    })),
    exceptions: result.exceptions.map((e) => ({
      code: e.code,
      severity: e.severity,
      message: e.message,
      materialCode: e.materialCode,
      materialName: e.materialName,
      value: e.value,
    })),
    summary: result.summary as Record<string, number>,
    tables: {
      balances: result.balances as unknown as Array<Record<string, string | number>>,
      replenish: result.replenishTickets,
      scrap: result.scrapTickets,
      variance: result.varianceTickets,
    },
    appliedActions: input.actions,
    aiPayload: result.aiPayload as unknown as Record<string, unknown>,
    _materialDaily: result,
  } as ProductionWorkflowResult & { _materialDaily?: MaterialDailyCloseWorkflowResult };
}

function buildMaterialDailyDeliverables(result: ProductionWorkflowResult): ProductionDeliverable[] {
  const md = (result as ProductionWorkflowResult & { _materialDaily?: MaterialDailyCloseWorkflowResult })
    ._materialDaily;
  if (!md || md.blocked) {
    return buildFiveDeliverables({
      result: {
        workflowCode: 'PRODUCTION_MATERIAL_DAILY_CLOSE',
        generatedAt: result.generatedAt,
        detections: [],
        clarifications: [],
        blocked: false,
        balances: [],
        calcDetails: [],
        replenishTickets: [],
        scrapTickets: [],
        varianceTickets: [],
        exceptions: [],
        summary: {
          inventoryRows: 0,
          issueRows: 0,
          returnRows: 0,
          scrapRows: 0,
          planRows: 0,
          balanceRows: 0,
          replenishCount: 0,
          scrapTicketCount: 0,
          varianceCount: 0,
          totalReplenishQty: 0,
          totalScrapQty: 0,
          totalShortageQty: 0,
          totalOverageQty: 0,
        },
        aiPayload: {
          meta: {
            workflowCode: 'PRODUCTION_MATERIAL_DAILY_CLOSE',
            generatedAt: result.generatedAt,
            sourceFiles: [],
          },
          metrics: {},
          sampleReplenish: [],
          sampleScrap: [],
          sampleVariance: [],
          exceptions: [],
          note: '',
        },
      },
      rules: DEFAULT_ENTERPRISE_RULES,
    }).map((f) => ({ kind: f.kind, fileName: f.fileName, bytes: f.bytes }));
  }
  return buildFiveDeliverables({ result: md, rules: DEFAULT_ENTERPRISE_RULES }).map((f) => ({
    kind: f.kind,
    fileName: f.fileName,
    bytes: f.bytes,
  }));
}

const DEFINITIONS: ProductionWorkflowDefinition[] = [
  {
    taskCode: 'material_daily_close',
    templateCode: TEMPLATE_CODE_BY_WORKFLOW.material_daily_close,
    name: '物料日清',
    description: '办结今日库存/领退/废料，导出结存与补料报废盘点单据',
    requiredInputs: [
      { key: 'inventory', label: '当前库存表', required: true, hints: ['库存', '盘点'] },
      { key: 'issue', label: '今日领料表', required: false, hints: ['领料'] },
      { key: 'return', label: '今日退料表', required: false, hints: ['退料'] },
      { key: 'scrap', label: '今日废料表', required: false, hints: ['废料', '报废'] },
    ],
    optionalInputs: [{ key: 'plan', label: '生产计划', required: false, hints: ['计划'] }],
    fieldDictionary: ['materialCode', 'materialName', 'warehouse', 'openingQuantity', 'issuedQuantity'],
    ruleEngine: 'material-daily-close/calcEngine',
    exceptionDefinitions: ['NEGATIVE_INVENTORY', 'EXCESSIVE_SCRAP', 'COUNT_DIFFERENCE'],
    aiAllowedOperations: ['FIELD_RECOGNITION', 'REMARK_CLASSIFICATION', 'EXCEPTION_EXPLANATION'],
    deliverables: ['今日物料结存', '补料申请单', '报废待审批单', '盘点差异单', '人工确认清单'],
    enabled: true,
    version: '1.0.0',
    run: adaptMaterialDailyClose,
    buildDeliverables: buildMaterialDailyDeliverables,
  },
  {
    taskCode: 'material_variance_close',
    templateCode: TEMPLATE_CODE_BY_WORKFLOW.material_variance_close,
    name: '核对物料消耗',
    description: '对比 BOM 理论消耗与领退实际消耗，输出超耗与待退料单据',
    requiredInputs: [
      { key: 'bom', label: 'BOM/标准用量', required: true, hints: ['BOM', '标准', '定额'] },
      { key: 'output', label: '实际产量', required: true, hints: ['产量', '完工'] },
      { key: 'issue', label: '领料', required: true, hints: ['领料'] },
    ],
    optionalInputs: [
      { key: 'return', label: '退料', required: false, hints: ['退料'] },
      { key: 'scrap', label: '报废', required: false, hints: ['报废'] },
    ],
    fieldDictionary: ['materialCode', 'standardUsage', 'goodOutput', 'issuedQuantity', 'returnedQuantity'],
    ruleEngine: 'material-variance-close',
    exceptionDefinitions: ['EXCESS_CONSUMPTION', 'ABNORMAL_ISSUE', 'INVALID_RETURN'],
    aiAllowedOperations: ['FIELD_RECOGNITION', 'EXCEPTION_EXPLANATION'],
    deliverables: ['物料消耗差异', '超耗核实单', '异常领料单', '待退料清单', '人工确认清单'],
    enabled: true,
    version: '1.0.0',
    run: runMaterialVarianceClose,
    buildDeliverables: buildMaterialVarianceDeliverables,
  },
  {
    taskCode: 'production_plan_close',
    templateCode: TEMPLATE_CODE_BY_WORKFLOW.production_plan_close,
    name: '清理生产计划',
    description: '清理待完成、延期、阻塞与已完成待关闭工单',
    requiredInputs: [
      { key: 'plan', label: '生产计划', required: true, hints: ['计划'] },
      { key: 'wo', label: '工单', required: true, hints: ['工单'] },
      { key: 'done', label: '实际完工', required: true, hints: ['完工'] },
    ],
    optionalInputs: [{ key: 'wip', label: '在制状态', required: false, hints: ['在制'] }],
    fieldDictionary: ['workOrder', 'plannedQuantity', 'completedQuantity', 'dueDate', 'status'],
    ruleEngine: 'production-plan-close',
    exceptionDefinitions: ['DELAYED_WO', 'BLOCKED_WO'],
    aiAllowedOperations: ['FIELD_RECOGNITION', 'EXCEPTION_EXPLANATION'],
    deliverables: ['今日待完成工单', '延期工单', '阻塞工单', '已完成待关闭', '生产进度调整清单'],
    enabled: true,
    version: '1.0.0',
    run: runProductionPlanClose,
    buildDeliverables: buildProductionPlanDeliverables,
  },
  {
    taskCode: 'output_attainment_close',
    templateCode: TEMPLATE_CODE_BY_WORKFLOW.output_attainment_close,
    name: '办结今日产量',
    description: '核算产量达成、未达成工单与缺口处理单',
    requiredInputs: [
      { key: 'plan', label: '生产计划', required: true, hints: ['计划'] },
      { key: 'wo', label: '工单', required: true, hints: ['工单'] },
      { key: 'done', label: '实际完工', required: true, hints: ['完工', '产量'] },
    ],
    optionalInputs: [{ key: 'team', label: '班组/产线记录', required: false, hints: ['班组', '产线'] }],
    fieldDictionary: ['workOrder', 'plannedOutput', 'actualOutput', 'line', 'team'],
    ruleEngine: 'output-attainment-close',
    exceptionDefinitions: ['LOW_ATTAINMENT'],
    aiAllowedOperations: ['FIELD_RECOGNITION', 'EXCEPTION_EXPLANATION'],
    deliverables: ['今日产量达成明细', '未达成工单', '产量缺口处理单', '人工确认清单'],
    enabled: true,
    version: '1.0.0',
    run: runOutputAttainmentClose,
    buildDeliverables: buildOutputAttainmentDeliverables,
  },
  {
    taskCode: 'quality_exception_close',
    templateCode: TEMPLATE_CODE_BY_WORKFLOW.quality_exception_close,
    name: '处理质量异常',
    description: '办结不良、返工、报废与异常批次跟踪',
    requiredInputs: [
      { key: 'qc', label: '质检记录', required: true, hints: ['质检'] },
      { key: 'defect', label: '不良品记录', required: true, hints: ['不良'] },
      { key: 'done', label: '完工记录', required: false, hints: ['完工'] },
    ],
    optionalInputs: [{ key: 'rework', label: '返工/报废记录', required: false, hints: ['返工', '报废'] }],
    fieldDictionary: ['batch', 'defects', 'output', 'defectType', 'scrapQty', 'reworkQty'],
    ruleEngine: 'quality-exception-close',
    exceptionDefinitions: ['HIGH_DEFECT_RATE', 'HAS_DEFECT'],
    aiAllowedOperations: ['FIELD_RECOGNITION', 'QUALITY_TEXT_CLASSIFICATION', 'EXCEPTION_EXPLANATION'],
    deliverables: ['质量异常处置单', '返工任务单', '报废待审批单', '异常批次跟踪单', '人工确认清单'],
    enabled: true,
    version: '1.0.0',
    run: runQualityExceptionClose,
    buildDeliverables: buildQualityExceptionDeliverables,
  },
  {
    taskCode: 'downtime_loss_close',
    templateCode: TEMPLATE_CODE_BY_WORKFLOW.downtime_loss_close,
    name: '处理停机损失',
    description: '核算停机损失产量、维修待办与重复故障',
    requiredInputs: [
      { key: 'downtime', label: '停机记录', required: true, hints: ['停机'] },
      { key: 'equipment', label: '设备资料', required: false, hints: ['设备'] },
    ],
    optionalInputs: [
      { key: 'plan', label: '生产计划', required: false, hints: ['计划'] },
      { key: 'output', label: '实际产量', required: false, hints: ['产量'] },
      { key: 'takt', label: '标准节拍', required: false, hints: ['节拍'] },
    ],
    fieldDictionary: ['equipment', 'downtimeMinutes', 'reason', 'standardTakt'],
    ruleEngine: 'downtime-loss-close',
    exceptionDefinitions: ['LONG_DOWNTIME', 'REPEAT_FAULT'],
    aiAllowedOperations: ['FIELD_RECOGNITION', 'DOWNTIME_REASON_CLASSIFICATION', 'EXCEPTION_EXPLANATION'],
    deliverables: ['停机事件明细', '停机损失产量', '设备维修待办', '重复故障跟踪单', '人工确认清单'],
    enabled: true,
    version: '1.0.0',
    run: runDowntimeLossClose,
    buildDeliverables: buildDowntimeLossDeliverables,
  },
];

/** ProductionWorkflowRegistry：禁止各工作流复制 Runtime */
export const ProductionWorkflowRegistry = {
  list(): ProductionWorkflowDefinition[] {
    return DEFINITIONS.filter((d) => d.enabled);
  },
  get(taskCode: string): ProductionWorkflowDefinition | undefined {
    return DEFINITIONS.find((d) => d.taskCode === taskCode || d.templateCode === taskCode);
  },
  require(taskCode: string): ProductionWorkflowDefinition {
    const def = this.get(taskCode);
    if (!def) throw new Error(`未知生产工作流: ${taskCode}`);
    return def;
  },
};

export function runProductionWorkflow(
  taskCode: string,
  input: RunProductionWorkflowInput & { historyStore?: LocalHistoryStore; scopeKey?: string },
): ProductionWorkflowResult {
  const def = ProductionWorkflowRegistry.require(taskCode);
  const result = def.run(input);
  (result as ProductionWorkflowResult & { _workbooks?: RunProductionWorkflowInput['workbooks'] })._workbooks =
    input.workbooks;
  return result;
}

export function buildProductionDeliverables(
  taskCode: string,
  result: ProductionWorkflowResult,
): ProductionDeliverable[] {
  return ProductionWorkflowRegistry.require(taskCode).buildDeliverables(result);
}

export function recomputeWithActions(
  taskCode: string,
  _previous: ProductionWorkflowResult,
  actions: AppliedProductionAction[],
  workbooks: RunProductionWorkflowInput['workbooks'],
): ProductionWorkflowResult {
  return runProductionWorkflow(taskCode, { workbooks, actions });
}
