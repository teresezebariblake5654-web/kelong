import { describe, expect, it } from 'vitest';
import { getWorkflowDefinition } from '@aw/task-templates';
import {
  appendOrReplaceRoleFile,
  createEmptyRoleInputs,
  findDuplicateFileAssignment,
  requiredRolesReady,
  roleAllowsMulti,
  toExecuteInputFiles,
} from './workflowInputValidation';
import type { SelectedLocalFile } from './types';

function file(name: string, sha: string): SelectedLocalFile {
  return {
    name,
    path: `memory://${name}`,
    size: 10,
    sha256: sha,
    extension: 'xlsx',
  };
}

describe('workflowInputValidation', () => {
  it('supports multi-file employee_files role', () => {
    const definition = getWorkflowDefinition('HR-EMPLOYEE-FILE-003')!;
    expect(roleAllowsMulti(definition, 'employee_files')).toBe(true);
    const empty = createEmptyRoleInputs(definition);
    const withOne = appendOrReplaceRoleFile(empty.employee_files!, file('a.xlsx', 'a'), true);
    const withTwo = appendOrReplaceRoleFile(withOne, file('b.xlsx', 'b'), true);
    expect(withTwo.files).toHaveLength(2);

    const inputs = { ...empty, employee_files: withTwo };
    expect(
      requiredRolesReady(definition, inputs, { employee_files: true }),
    ).toBe(true);
    expect(toExecuteInputFiles(definition, inputs)).toHaveLength(2);
  });

  it('detects duplicate file across roles', () => {
    const inputs = {
      employee_master: { role: 'employee_master', files: [file('same.xlsx', 'sha1')] },
      salary_standard: { role: 'salary_standard', files: [] },
    };
    expect(findDuplicateFileAssignment(inputs, 'salary_standard', file('same.xlsx', 'sha1'))).toBe(
      'employee_master',
    );
    expect(findDuplicateFileAssignment(inputs, 'salary_standard', file('other.xlsx', 'sha2'))).toBe(
      null,
    );
  });
});

import * as XLSX from 'xlsx';
import { detectWorkflowUploadContext } from '@aw/data-engine';
import { workflowAliasesForRole } from './fieldInspect';

function attendanceWorkbookBytes(): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const sheets: Array<[string, unknown[][]]> = [
    ['人员信息', [['工号', '姓名', '在职状态'], ['E001', '张三', '在职']]],
    ['本月班次', [['工号', '日期', '上班时间', '下班时间'], ['E001', '2026-07-01', '09:00', '18:00']]],
    ['门禁数据', [['工号', '打卡时间'], ['E001', '2026-07-01 09:03']]],
    ['休假', [['工号', '日期', '请假类型', '小时'], ['E001', '2026-07-02', '事假', 8]]],
  ];
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as number[]);
}

describe('unified workflow upload detection', () => {
  it('maps one multi-sheet workbook to attendance roles without asking file types', () => {
    const definition = getWorkflowDefinition('HR-ATTENDANCE-002')!;
    const detected = detectWorkflowUploadContext({
      sources: [{ fileId: 'attendance', fileName: '七月数据.xlsx', bytes: attendanceWorkbookBytes() }],
      roles: definition.inputRoles.map((role) => ({
        role: role.role,
        description: role.description || role.role,
        required: role.required,
        requiredFields: role.requiredFields,
        aliases: workflowAliasesForRole(role.role, role.requiredFields),

      })),
    });

    expect(detected.context.files[0]?.sheets).toHaveLength(4);
    expect(detected.context.matchedTemplates.map((item) => item.role)).toEqual(
      expect.arrayContaining(['employee_master', 'schedule', 'punch', 'leave']),
    );
    expect(detected.preparedInputs).toHaveLength(4);
    expect(detected.context.clarifications).toHaveLength(0);
    expect(detected.context.confidence).toBeGreaterThanOrEqual(0.9);
  });
});


