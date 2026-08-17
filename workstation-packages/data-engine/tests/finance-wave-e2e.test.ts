import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createWorkflowRuntime } from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

describe('Finance wave e2e — all 5 workflows', () => {
  it('executes all finance workflows, re-reads sheets, fetch=0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-fin-wave-'));
    const out = join(dir, 'out');
    const runtime = createWorkflowRuntime();
    let fetchCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return original(...args);
    }) as typeof fetch;

    try {
      const expense = join(dir, 'expense.xlsx');
      writeSheet(expense, [
        ['费用编号', '日期', '报销人', '金额', '税额', '说明', '费用类型', '有票'],
        ['EX001', '2026-07-10', '张三', 100, 0, '差旅', '差旅', '是'],
      ]);
      const expenseResult = await runtime.execute({
        workflowId: 'FIN-EXPENSE-CLEAN-001',
        inputFiles: [{ role: 'expense', path: expense }],
        outputDir: out,
        runDate: '2026-07-15',
      });

      const bank = join(dir, 'bank.xlsx');
      const ledger = join(dir, 'ledger.xlsx');
      writeSheet(bank, [
        ['流水号', '日期', '金额', '方向', '对方', '摘要', '参考号'],
        ['B1', '2026-07-10', 100, 'IN', '客户A', '收款', 'R001'],
      ]);
      writeSheet(ledger, [
        ['单据号', '日期', '金额', '方向', '对方', '状态', '参考号'],
        ['L1', '2026-07-10', 100, 'IN', '客户A', 'OPEN', 'R001'],
      ]);
      const recResult = await runtime.execute({
        workflowId: 'FIN-RECONCILIATION-002',
        inputFiles: [
          { role: 'bank_statement', path: bank },
          { role: 'ledger', path: ledger },
        ],
        outputDir: out,
        runDate: '2026-07-15',
      });

      const open = join(dir, 'open.xlsx');
      writeSheet(open, [
        ['单据号', '客商编码', '客商名称', '单据类型', '开票日期', '到期日', '原金额', '未结金额'],
        ['AR1', 'C01', '客户甲', '应收', '2026-06-01', '2026-07-20', 100, 100],
        ['AP1', 'S01', '供应商乙', '应付', '2026-06-01', '2026-07-20', 50, 50],
      ]);
      const arapResult = await runtime.execute({
        workflowId: 'FIN-ARAP-003',
        inputFiles: [{ role: 'open_items', path: open }],
        outputDir: out,
        runDate: '2026-07-15',
      });

      const inv = join(dir, 'inv.xlsx');
      writeSheet(inv, [
        ['发票代码', '发票号码', '开票日期', '销方名称', '销方税号', '金额', '税额', '价税合计'],
        ['110', '0001', '2026-07-01', '供应商A', 'T001', 100, 13, 113],
      ]);
      const invResult = await runtime.execute({
        workflowId: 'FIN-INVOICE-OCR-004',
        inputFiles: [{ role: 'invoice_files', path: inv }],
        outputDir: out,
        runDate: '2026-07-15',
      });

      const rev = join(dir, 'rev.xlsx');
      const cost = join(dir, 'cost.xlsx');
      const exp = join(dir, 'exp.xlsx');
      writeSheet(rev, [
        ['日期', '业务单元', '产品', '收入'],
        ['2026-07-01', 'BU1', 'P1', 100],
      ]);
      writeSheet(cost, [
        ['日期', '业务单元', '产品', '成本'],
        ['2026-07-01', 'BU1', 'P1', 40],
      ]);
      writeSheet(exp, [
        ['日期', '业务单元', '费用类型', '金额'],
        ['2026-07-01', 'BU1', '差旅', 10],
      ]);
      const opsResult = await runtime.execute({
        workflowId: 'FIN-OPERATING-SUMMARY-005',
        inputFiles: [
          { role: 'revenue', path: rev },
          { role: 'cost', path: cost },
          { role: 'expense', path: exp },
        ],
        outputDir: out,
        runDate: '2026-07-15',
      });

      const runs = [
        {
          result: expenseResult,
          sheets: ['标准费用明细', '重复费用', '超标准', '缺票清单', '待分科目', '规则快照', '运行说明'],
        },
        {
          result: recResult,
          sheets: [
            '匹配结果',
            '部分匹配',
            '未匹配银行',
            '未匹配账务',
            '歧义候选',
            '控制汇总',
            '规则快照',
            '运行说明',
          ],
        },
        {
          result: arapResult,
          sheets: [
            '应收账龄',
            '应付账龄',
            '催收优先级',
            '付款优先级',
            '异常项目',
            '集中度汇总',
            '规则快照',
            '运行说明',
          ],
        },
        {
          result: invResult,
          sheets: ['发票登记表', '重复发票', '低置信度', '采购匹配', '金额异常', '规则快照', '运行说明'],
        },
        {
          result: opsResult,
          sheets: [
            '经营总览',
            '业务单元',
            '产品渠道',
            '费用分摊',
            '预算差异',
            '重大异常',
            '规则快照',
            '运行说明',
          ],
        },
      ];

      for (const run of runs) {
        expect(run.result.errorMessage).toBeUndefined();
        expect(['COMPLETED', 'NEEDS_REVIEW']).toContain(run.result.status);
        expect(run.result.outputFiles[0]).toBeTruthy();
        const wb = XLSX.read(readFileSync(run.result.outputFiles[0]!), { type: 'buffer' });
        expect(wb.SheetNames).toEqual(run.sheets);
        expect(run.result.aiSummaryPayload?.rawRows).toBe(false);
        expect(run.result.metrics.cloudUpload).toBe(false);
      }

      expect(fetchCount).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
