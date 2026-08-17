import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
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

describe('HR wave e2e — all 7 workflows', () => {
  it('executes all HR workflows and re-reads XLSX sheet names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-hr-wave-'));
    const out = join(dir, 'out');
    const runtime = createWorkflowRuntime();
    let fetchCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return original(...args);
    }) as typeof fetch;

    try {
      // 1 payroll
      const emp = join(dir, 'p-emp.xlsx');
      const sal = join(dir, 'p-sal.xlsx');
      const att = join(dir, 'p-att.xlsx');
      writeSheet(emp, [
        ['工号', '姓名', '部门', '在职状态', '入职日期', '银行账号', '开户行'],
        ['E001', '张三', '研发', '在职', '2024-01-10', '62220001', '工行'],
      ]);
      writeSheet(sal, [['工号', '基本工资', '时薪'], ['E001', 8700, 50]]);
      writeSheet(att, [
        ['工号', '应出勤天数', '实出勤天数', '缺勤天数', '加班小时', '迟到分钟'],
        ['E001', 21.75, 21.75, 0, 0, 0],
      ]);
      const payroll = await runtime.execute({
        workflowId: 'HR-PAYROLL-001',
        inputFiles: [
          { role: 'employee_master', path: emp },
          { role: 'salary_standard', path: sal },
          { role: 'attendance_summary', path: att },
        ],
        outputDir: out,
        runDate: '2026-07-15',
      });

      // 2 attendance
      const aEmp = join(dir, 'a-emp.xlsx');
      const aSch = join(dir, 'a-sch.xlsx');
      const aPunch = join(dir, 'a-punch.xlsx');
      writeSheet(aEmp, [['工号', '姓名', '部门', '在职状态'], ['E001', '张三', '研发', '在职']]);
      writeSheet(aSch, [
        ['工号', '日期', '上班时间', '下班时间'],
        ['E001', '2026-07-01', '09:00', '18:00'],
      ]);
      writeSheet(aPunch, [
        ['工号', '打卡时间'],
        ['E001', '2026-07-01 09:00'],
        ['E001', '2026-07-01 18:00'],
      ]);
      const attendance = await runtime.execute({
        workflowId: 'HR-ATTENDANCE-002',
        inputFiles: [
          { role: 'employee_master', path: aEmp },
          { role: 'schedule', path: aSch },
          { role: 'punch', path: aPunch },
        ],
        outputDir: out,
        runDate: '2026-07-15',
      });

      // 3 employee file
      const eFile = join(dir, 'efile.xlsx');
      writeSheet(eFile, [
        ['工号', '姓名', '部门', '入职日期', '在职状态', '手机', '身份证', '银行账号', '合同到期', '证照到期'],
        [
          'E001',
          '张三',
          '研发',
          '2024-01-10',
          '在职',
          '13800001111',
          '110101199001011234',
          '62220001',
          '2027-01-01',
          '2027-06-01',
        ],
      ]);
      const employeeFile = await runtime.execute({
        workflowId: 'HR-EMPLOYEE-FILE-003',
        inputFiles: [{ role: 'employee_files', path: eFile }],
        outputDir: out,
        runDate: '2026-07-15',
      });

      // 4 onboard/offboard
      const ch = join(dir, 'change.xlsx');
      const tpl = join(dir, 'tpl.xlsx');
      const st = join(dir, 'status.xlsx');
      writeSheet(ch, [
        ['工号', '姓名', '变动类型', '生效日期', '部门', '岗位'],
        ['E001', '张三', '入职', '2026-07-01', '研发', '工程师'],
      ]);
      writeSheet(tpl, [
        ['变动类型', '部门', '任务名称', '负责角色', '截止偏移天'],
        ['ONBOARD', '研发', '合同签署', 'HR', 1],
        ['ONBOARD', '研发', '账号开通', 'IT', 2],
      ]);
      writeSheet(st, [
        ['工号', '任务名称', '状态'],
        ['E001', '合同签署', '完成'],
        ['E001', '账号开通', '完成'],
      ]);
      const onboard = await runtime.execute({
        workflowId: 'HR-ONBOARD-OFFBOARD-004',
        inputFiles: [
          { role: 'employee_changes', path: ch },
          { role: 'task_template', path: tpl },
          { role: 'task_status', path: st },
        ],
        outputDir: out,
        runDate: '2026-07-15',
      });

      // 5 social
      const sEmp = join(dir, 's-emp.xlsx');
      const sBase = join(dir, 's-base.xlsx');
      const sPay = join(dir, 's-pay.xlsx');
      writeSheet(sEmp, [
        ['工号', '入职日期', '在职状态'],
        ['E001', '2024-01-10', '在职'],
      ]);
      writeSheet(sBase, [['工号', '社保基数', '公积金基数'], ['E001', 10000, 10000]]);
      writeSheet(sPay, [
        ['工号', '社保金额', '公积金金额', '缴费月'],
        ['E001', 1050, 1200, '2026-07'],
      ]);
      const social = await runtime.execute({
        workflowId: 'HR-SOCIAL-INSURANCE-005',
        inputFiles: [
          { role: 'employee_master', path: sEmp },
          { role: 'declared_base', path: sBase },
          { role: 'payment_detail', path: sPay },
        ],
        outputDir: out,
        runDate: '2026-07-15',
      });

      // 6 recruitment
      const cand = join(dir, 'cand.xlsx');
      writeSheet(cand, [
        ['候选人编号', '姓名', '职位', '来源', '阶段', '阶段日期'],
        ['C001', '甲', '工程师', '猎头', 'HIRED', '2026-07-01'],
      ]);
      const recruit = await runtime.execute({
        workflowId: 'HR-RECRUITMENT-FUNNEL-006',
        inputFiles: [{ role: 'candidates', path: cand }],
        outputDir: out,
        runDate: '2026-07-15',
      });

      // 7 performance
      const perf = join(dir, 'perf.xlsx');
      writeSheet(perf, [
        ['工号', '姓名', '部门', '职级', '分数', '评级'],
        ['E001', '张三', '研发', 'P5', 88, 'B'],
        ['E002', '李四', '研发', 'P5', 92, 'A'],
      ]);
      const performance = await runtime.execute({
        workflowId: 'HR-PERFORMANCE-DISTRIBUTION-007',
        inputFiles: [{ role: 'performance', path: perf }],
        outputDir: out,
        runDate: '2026-07-15',
      });

      const runs = [
        {
          name: 'payroll',
          result: payroll,
          sheets: ['工资明细', '银行发薪', '部门汇总', '异常待人工', '规则快照', '运行说明'],
        },
        {
          name: 'attendance',
          result: attendance,
          sheets: ['考勤明细', '异常待确认', '加班统计', '缺卡清单', '请假冲突', '运行说明'],
        },
        {
          name: 'employeeFile',
          result: employeeFile,
          sheets: ['标准员工档案', '重复冲突', '缺失资料', '合同到期', '证照到期', '运行说明'],
        },
        {
          name: 'onboard',
          result: onboard,
          sheets: ['人员总览', '待办任务', '已完成任务', '逾期任务', '阻塞办结', '运行说明'],
        },
        {
          name: 'social',
          result: social,
          sheets: ['核对总表', '漏缴清单', '重复缴费', '基数异常', '金额差异', '规则版本', '运行说明'],
        },
        {
          name: 'recruit',
          result: recruit,
          sheets: ['招聘漏斗', '来源转化', '职位转化', '停滞候选人', '招聘缺口', '重复候选人', '运行说明'],
        },
        {
          name: 'performance',
          result: performance,
          sheets: ['绩效分布', '部门职级分析', '校准建议', '离群人员', '数据异常', '运行说明'],
        },
      ];

      for (const run of runs) {
        expect(run.result.errorMessage, run.name).toBeUndefined();
        expect(['COMPLETED', 'NEEDS_REVIEW']).toContain(run.result.status);
        expect(run.result.outputFiles.length).toBe(1);
        expect(existsSync(run.result.outputFiles[0]!)).toBe(true);
        const wb = XLSX.read(readFileSync(run.result.outputFiles[0]!), { type: 'buffer' });
        expect(wb.SheetNames).toEqual(run.sheets);
        expect(run.result.aiSummaryPayload?.rawRows).toBe(false);
        expect(run.result.metrics.cloudUpload ?? false).toBe(false);
      }

      expect(fetchCount).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
