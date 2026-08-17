import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  calculatePareto,
  createWorkflowRuntime,
  evaluateExpectedValue,
  evaluateQualityLimit,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

async function runQuality(options: {
  inspection: unknown[][];
  standard: unknown[][];
  rules?: Record<string, unknown>;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-qa-'));
  const inspectionPath = join(dir, 'inspection.xlsx');
  const standardPath = join(dir, 'standard.xlsx');
  writeSheet(inspectionPath, options.inspection);
  writeSheet(standardPath, options.standard);
  const result = await createWorkflowRuntime().execute({
    workflowId: 'PROD-QUALITY-005',
    inputFiles: [
      { role: 'inspection', path: inspectionPath },
      { role: 'quality_standard', path: standardPath },
    ],
    rules: options.rules,
    outputDir: join(dir, 'out'),
    runDate: '2026-07-22',
  });
  const workbook = result.outputFiles[0]
    ? XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' })
    : null;
  return { result, workbook };
}

describe('quality operators', () => {
  it('evaluates numeric/boolean/enum and pareto', () => {
    expect(evaluateQualityLimit({ result: 5, lowerLimit: 1, upperLimit: 10 }).passFlag).toBe(true);
    expect(evaluateQualityLimit({ result: 0, lowerLimit: 1, upperLimit: 10 }).passFlag).toBe(false);
    expect(evaluateQualityLimit({ result: 12, lowerLimit: 1, upperLimit: 10 }).passFlag).toBe(false);
    expect(evaluateQualityLimit({ result: 5, lowerLimit: 1 }).passFlag).toBe(true);
    expect(evaluateQualityLimit({ result: 5, upperLimit: 4 }).passFlag).toBe(false);
    expect(
      evaluateExpectedValue({ result: '合格', expectedValue: '合格', resultType: 'BOOLEAN' }).passFlag,
    ).toBe(true);
    expect(
      evaluateExpectedValue({ result: 'A', expectedValue: 'B', resultType: 'ENUM' }).passFlag,
    ).toBe(false);
    const pareto = calculatePareto(
      [
        { defectType: '划伤', failedQty: 5 },
        { defectType: '气泡', failedQty: 3 },
        { defectType: '色差', failedQty: 2 },
      ],
      { threshold: 0.8 },
    );
    expect(pareto[0]?.defectType).toBe('划伤');
    expect(pareto[0]?.isParetoMajor).toBe(true);
  });
});

describe('PROD-QUALITY-005', () => {
  it('pass/fail/critical/missing/duplicate/sheets/AI', async () => {
    const { result, workbook } = await runQuality({
      inspection: [
        ['检验单号', '检验日期', '产品编码', '批次号', '工单号', '检验项目', '结果', '缺陷类型', '缺陷等级'],
        ['I-1', '2026-07-20', 'P-1', 'L-1', 'WO-1', '尺寸', 5, '', ''],
        ['I-2', '2026-07-20', 'P-1', 'L-1', 'WO-1', '尺寸', 20, '超差', '一般'],
        ['I-3', '2026-07-20', 'P-1', 'L-2', 'WO-1', '外观', '不合格', '裂纹', '致命'],
        ['I-4', '2026-07-20', 'P-2', 'L-3', 'WO-2', '硬度', 1, '', ''],
        ['I-5', '2026-07-20', 'P-1', 'L-1', 'WO-1', '尺寸', 6, '', ''],
        ['I-5', '2026-07-21', 'P-1', 'L-1', 'WO-1', '尺寸', 6, '', ''],
      ],
      standard: [
        ['产品编码', '检验项目', '结果类型', '下限', '上限', '期望值', '标准版本', '致命'],
        ['P-1', '尺寸', 'NUMERIC', 1, 10, '', 'V1', ''],
        ['P-1', '外观', 'BOOLEAN', '', '', '合格', 'V1', '是'],
      ],
      rules: {
        criticalDefects: ['裂纹'],
        duplicateInspectionStrategy: 'BLOCK',
        failRateThreshold: 0.01,
      },
    });

    expect(result.errorMessage).toBeUndefined();
    expect(workbook!.SheetNames).toEqual([
      '质量总览',
      '隔离清单',
      '缺陷Pareto',
      '批次追溯',
      '缺标准',
      '重复检验',
      '运行说明',
    ]);
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(Number(result.metrics.missingStandardCount)).toBeGreaterThan(0);
    expect(JSON.stringify(result.aiSummaryPayload)).not.toContain('L-1');
    expect(JSON.stringify(result.aiSummaryPayload)).not.toContain('WO-1');
    expect(result.aiSummaryPayload?.rawRows).toBe(false);
    expect(result.metrics.uploadedRawWorkbook).toBe(false);

    const a = await runQuality({
      inspection: [
        ['检验单号', '检验日期', '产品编码', '批次号', '工单号', '检验项目', '结果'],
        ['I-1', '2026-07-20', 'P-1', 'L-1', 'WO-1', '尺寸', 5],
      ],
      standard: [
        ['产品编码', '检验项目', '结果类型', '下限', '上限'],
        ['P-1', '尺寸', 'NUMERIC', 1, 10],
      ],
    });
    const b = await runQuality({
      inspection: [
        ['检验单号', '检验日期', '产品编码', '批次号', '工单号', '检验项目', '结果'],
        ['I-1', '2026-07-20', 'P-1', 'L-1', 'WO-1', '尺寸', 5],
      ],
      standard: [
        ['产品编码', '检验项目', '结果类型', '下限', '上限'],
        ['P-1', '尺寸', 'NUMERIC', 1, 10],
      ],
    });
    expect(a.result.metrics.inspectionCount).toBe(b.result.metrics.inspectionCount);
  });
});
