import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { daysBetween } from '../operators/dateWindow.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  detectDuplicateKeys,
  hashSensitive,
} from '../operators/hrCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { normalizeDate } from '../operators/normalizeDate.js';
import { toRecruitmentRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const STAGES = ['NEW', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'] as const;

const CAND_ALIASES: FieldAliasMap = {
  candidateId: ['候选人编号', '候选人ID', 'candidate_id', 'id'],
  candidateName: ['姓名', '候选人', 'candidate_name', 'name'],
  position: ['职位', '岗位', 'position', 'job'],
  source: ['来源', '渠道', 'source', 'channel'],
  stage: ['阶段', '状态', 'stage', 'status'],
  stageDate: ['阶段日期', '日期', 'stage_date', 'date'],
  phone: ['手机', '电话', 'phone', 'mobile'],
  email: ['邮箱', 'email'],
};
const PLAN_ALIASES: FieldAliasMap = {
  position: ['职位', '岗位', 'position', 'job'],
  plannedHeadcount: ['计划人数', '需求人数', 'planned_headcount', 'headcount'],
  targetDate: ['目标日期', '截止日期', 'target_date'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function toYmd(value: unknown): string {
  const parsed = normalizeDate(value);
  return parsed.ok ? parsed.value : asText(value).slice(0, 10);
}

function mapStage(raw: unknown): string {
  const t = asText(raw).toUpperCase();
  const original = asText(raw);
  if (t === 'NEW' || original.includes('新建') || original.includes('投递')) return 'NEW';
  if (t === 'SCREENING' || original.includes('筛选') || original.includes('初筛')) return 'SCREENING';
  if (t === 'INTERVIEW' || original.includes('面试')) return 'INTERVIEW';
  if (t === 'OFFER' || original.includes('录用') || original.includes('offer')) return 'OFFER';
  if (t === 'HIRED' || original.includes('入职')) return 'HIRED';
  if (t === 'REJECTED' || original.includes('拒绝') || original.includes('淘汰')) return 'REJECTED';
  if (t === 'WITHDRAWN' || original.includes('撤回') || original.includes('放弃')) return 'WITHDRAWN';
  return t || 'NEW';
}

function stageIndex(stage: string, order: string[]): number {
  const idx = order.indexOf(stage);
  if (idx >= 0) return idx;
  return STAGES.indexOf(stage as (typeof STAGES)[number]);
}

function normRole(ctx: OperatorContext, role: string, aliases: FieldAliasMap): DataRow[] {
  const ds = ctx.datasets.get(role);
  if (!ds) return [];
  return normalizeColumns(ds.rows, aliases, {
    role,
    sourceFile: ds.fileName,
    sourceSheet: ds.sheetName,
    inputSha256: ds.sha256,
  });
}

/** Thin orchestrator for HR-RECRUITMENT-FUNNEL-006. Deduped stage conversion, no double-count. */
export async function executeHrRecruitmentFunnel(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('candidates')) {
    throw new Error('candidates is required');
  }

  const rules = toRecruitmentRules(ctx.companyRules);
  const candidates: DataRow[] = normRole(ctx, 'candidates', CAND_ALIASES).map((row) => ({
    ...row,
    stage: mapStage(row.stage),
    stageDate: toYmd(row.stageDate),
    phoneHash: hashSensitive(row.phone),
    emailHash: hashSensitive(row.email),
  }));
  const plans = normRole(ctx, 'headcount_plan', PLAN_ALIASES);

  const exceptionRows: DataRow[] = [];
  const note = (
    candidateId: string,
    code: string,
    severity: 'INFO' | 'WARNING' | 'BLOCKING',
    message: string,
    sourceTrace: string,
  ) => {
    ctx.exceptions.push({ code, severity, message, row: { candidateId } });
    exceptionRows.push({ candidateId, code, severity, message, sourceTrace });
  };

  const idDups = detectDuplicateKeys(
    candidates.filter((c) => asText(c.candidateId)),
    ['candidateId'],
  );
  const phoneDups = detectDuplicateKeys(
    candidates.filter((c) => asText(c.phoneHash)),
    ['phoneHash'],
  );
  const emailDups = detectDuplicateKeys(
    candidates.filter((c) => asText(c.emailHash)),
    ['emailHash'],
  );
  const namePosDups = detectDuplicateKeys(
    candidates.filter((c) => asText(c.candidateName) && asText(c.position)),
    ['candidateName', 'position'],
  );

  const duplicateRows: DataRow[] = [];
  for (const group of [...idDups, ...phoneDups, ...emailDups, ...namePosDups]) {
    duplicateRows.push({
      key: group.key,
      count: group.count,
      candidateIds: group.rows.map((r) => asText(r.candidateId)).join('|'),
      sourceTrace: group.rows.map(traceOf).join('|'),
    });
    for (const row of group.rows) {
      note(asText(row.candidateId), 'DUPLICATE_CANDIDATE', 'WARNING', '候选人重复', traceOf(row));
    }
  }

  // Deduplicate by candidateId (keep furthest stage), else by phone/email/name+position
  const deduped = new Map<string, DataRow>();
  const order = rules.stageOrder;
  for (const row of candidates) {
    let key = asText(row.candidateId);
    if (!key) {
      key =
        asText(row.phoneHash) ||
        asText(row.emailHash) ||
        `${asText(row.candidateName).toLowerCase()}||${asText(row.position).toLowerCase()}`;
    }
    if (!key) continue;
    if (hasBlank(row.stageDate)) {
      note(asText(row.candidateId) || key, 'MISSING_STAGE_DATE', 'WARNING', '阶段日期缺失', traceOf(row));
    }
    const prev = deduped.get(key);
    if (!prev) {
      deduped.set(key, { ...row, _dedupeKey: key, sourceTrace: traceOf(row) });
      continue;
    }
    const prevIdx = stageIndex(asText(prev.stage), order);
    const nextIdx = stageIndex(asText(row.stage), order);
    const terminal = ['REJECTED', 'WITHDRAWN'].includes(asText(row.stage));
    const keep =
      terminal && !['REJECTED', 'WITHDRAWN'].includes(asText(prev.stage))
        ? false
        : nextIdx >= prevIdx;
    if (keep) {
      if (nextIdx < prevIdx && !terminal) {
        note(asText(row.candidateId) || key, 'STAGE_REGRESSION', 'WARNING', '阶段倒退', traceOf(row));
      }
      deduped.set(key, {
        ...row,
        _dedupeKey: key,
        firstStageDate: prev.firstStageDate ?? prev.stageDate,
        sourceTrace: `${asText(prev.sourceTrace)}|${traceOf(row)}`,
      });
    } else {
      deduped.set(key, {
        ...prev,
        firstStageDate: prev.firstStageDate ?? prev.stageDate,
      });
    }
  }

  const unique = [...deduped.values()];
  for (const row of unique) {
    if (!row.firstStageDate) row.firstStageDate = row.stageDate;
    const stale = daysBetween(asText(row.stageDate), ctx.runDate);
    if (
      stale !== null &&
      stale > rules.staleDays &&
      !['HIRED', 'REJECTED', 'WITHDRAWN'].includes(asText(row.stage))
    ) {
      note(asText(row.candidateId), 'STALE_CANDIDATE', 'WARNING', '停留超期', asText(row.sourceTrace));
    }
  }

  const reachedStage = (candidate: DataRow, target: string): boolean => {
    const cur = asText(candidate.stage);
    if (cur === 'REJECTED' || cur === 'WITHDRAWN') {
      // terminal — count only exact stage for funnel terminal buckets
      return cur === target;
    }
    const curIdx = stageIndex(cur, order);
    const targetIdx = stageIndex(target, order);
    if (targetIdx < 0) return cur === target;
    return curIdx >= targetIdx;
  };

  const funnelStages = [...order, 'REJECTED', 'WITHDRAWN'].filter(
    (s, i, arr) => arr.indexOf(s) === i,
  );
  const funnel: DataRow[] = funnelStages.map((stage) => {
    const count = unique.filter((c) => reachedStage(c, stage)).length;
    return { stage, uniqueCandidates: count };
  });

  // conversion without double-counting: unique candidates who reached stage N / who reached stage N-1
  for (let i = 0; i < funnel.length - 1; i++) {
    const cur = funnel[i]!;
    const next = funnel[i + 1]!;
    const denom = Number(cur.uniqueCandidates) || 0;
    cur.conversionToNext =
      denom === 0 ? 0 : Number((Number(next.uniqueCandidates) / denom).toFixed(4));
  }

  const bySource = new Map<string, DataRow[]>();
  const byPosition = new Map<string, DataRow[]>();
  for (const row of unique) {
    const source = asText(row.source) || '(空白)';
    const position = asText(row.position) || '(空白)';
    bySource.set(source, [...(bySource.get(source) ?? []), row]);
    byPosition.set(position, [...(byPosition.get(position) ?? []), row]);
  }

  const sourceConversion: DataRow[] = [...bySource.entries()].map(([source, list]) => {
    const hired = list.filter((c) => asText(c.stage) === 'HIRED').length;
    return {
      source,
      candidates: list.length,
      hired,
      hireRate: list.length === 0 ? 0 : Number((hired / list.length).toFixed(4)),
    };
  });

  const positionConversion: DataRow[] = [...byPosition.entries()].map(([position, list]) => {
    const hired = list.filter((c) => asText(c.stage) === 'HIRED').length;
    const offer = list.filter((c) => reachedStage(c, 'OFFER')).length;
    return {
      position,
      candidates: list.length,
      offer,
      hired,
      hireRate: list.length === 0 ? 0 : Number((hired / list.length).toFixed(4)),
    };
  });

  const staleRows: DataRow[] = unique
    .filter((c) => {
      const stale = daysBetween(asText(c.stageDate), ctx.runDate);
      return (
        stale !== null &&
        stale > rules.staleDays &&
        !['HIRED', 'REJECTED', 'WITHDRAWN'].includes(asText(c.stage))
      );
    })
    .map((c) => ({
      candidateId: c.candidateId,
      position: c.position,
      source: c.source,
      stage: c.stage,
      stageDate: c.stageDate,
      staleDays: daysBetween(asText(c.stageDate), ctx.runDate),
      sourceTrace: c.sourceTrace,
    }));

  const hiredByPosition = new Map<string, number>();
  const timeToHires: number[] = [];
  for (const row of unique) {
    if (asText(row.stage) !== 'HIRED') continue;
    const pos = asText(row.position) || '(空白)';
    hiredByPosition.set(pos, (hiredByPosition.get(pos) ?? 0) + 1);
    const tth = daysBetween(asText(row.firstStageDate), asText(row.stageDate));
    if (tth !== null) timeToHires.push(tth);
  }

  const hiringGap: DataRow[] = plans.map((plan) => {
    const position = asText(plan.position);
    const planned = Number(plan.plannedHeadcount ?? 0);
    const hired = hiredByPosition.get(position) ?? 0;
    return {
      position,
      plannedHeadcount: planned,
      hiredCount: hired,
      hiringGap: planned - hired,
      targetDate: plan.targetDate,
      sourceTrace: traceOf(plan),
    };
  });

  const avgTimeToHire =
    timeToHires.length === 0
      ? 0
      : Number((timeToHires.reduce((a, b) => a + b, 0) / timeToHires.length).toFixed(2));

  const runNotes = buildHrRunNotes({
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    runDate: ctx.runDate,
    rules: rules as unknown as Record<string, unknown>,
    inputSha256ByRole: ctx.inputSha256ByRole,
    inputRowCount: candidates.length,
    outputRowCount: unique.length,
    exceptionCount: exceptionRows.length,
    extras: [
      { key: 'uniqueCandidates', value: unique.length },
      { key: 'avgTimeToHire', value: avgTimeToHire },
    ],
  });

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '招聘漏斗分析_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '招聘漏斗', rows: funnel },
      { name: '来源转化', rows: sourceConversion },
      { name: '职位转化', rows: positionConversion },
      { name: '停滞候选人', rows: staleRows },
      { name: '招聘缺口', rows: hiringGap },
      { name: '重复候选人', rows: duplicateRows },
      { name: '运行说明', rows: runNotes },
    ],
  });

  ctx.metrics = {
    inputCandidates: candidates.length,
    uniqueCandidates: unique.length,
    hiredCount: unique.filter((c) => asText(c.stage) === 'HIRED').length,
    staleCount: staleRows.length,
    duplicateGroupCount: duplicateRows.length,
    avgTimeToHire,
    exceptionCount: exceptionRows.length,
    localExecution: true,
    cloudUpload: false,
    uploadedRawWorkbook: false,
  };

  return {
    runId: ctx.runId,
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    status: exceptionRows.length > 0 ? 'NEEDS_REVIEW' : 'COMPLETED',
    outputFiles: [outputPath],
    metrics: ctx.metrics,
    exceptions: aggregateExceptionCounts(ctx.exceptions),
    aiSummaryPayload: {
      workflowId: definition.id,
      workflowVersion: ctx.workflowVersion,
      runId: ctx.runId,
      rawRows: false,
      containsPii: false,
      metrics: {
        inputCandidates: candidates.length,
        uniqueCandidates: unique.length,
        hiredCount: ctx.metrics.hiredCount,
        staleCount: staleRows.length,
        duplicateGroupCount: duplicateRows.length,
        avgTimeToHire,
        exceptionCount: exceptionRows.length,
        funnel: funnel.map((f) => ({
          stage: f.stage,
          uniqueCandidates: f.uniqueCandidates,
          conversionToNext: f.conversionToNext ?? null,
        })),
        exceptionByCode: aggregateExceptionCounts(ctx.exceptions).map((e) => ({
          code: e.code,
          count: e.count,
          severity: e.severity,
        })),
      },
      note: 'Aggregates only; no candidate names/phones.',
    },
  };
}
