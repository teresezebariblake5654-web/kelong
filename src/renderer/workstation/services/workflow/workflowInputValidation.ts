import type { WorkflowDefinition } from '@aw/shared';
import { roleAllowsMultipleFiles } from './departmentCatalog';
import type { SelectedLocalFile } from './types';

export interface SelectedWorkflowInput {
  role: string;
  files: SelectedLocalFile[];
}

export function createEmptyRoleInputs(definition: WorkflowDefinition): Record<string, SelectedWorkflowInput> {
  const next: Record<string, SelectedWorkflowInput> = {};
  for (const role of definition.inputRoles) {
    next[role.role] = { role: role.role, files: [] };
  }
  return next;
}

export function requiredRolesReady(
  definition: WorkflowDefinition,
  inputs: Record<string, SelectedWorkflowInput>,
  canRunByRole: Record<string, boolean>,
): boolean {
  return definition.inputRoles
    .filter((r) => r.required)
    .every((role) => {
      const files = inputs[role.role]?.files ?? [];
      if (files.length === 0) return false;
      return canRunByRole[role.role] === true;
    });
}

export function findDuplicateFileAssignment(
  inputs: Record<string, SelectedWorkflowInput>,
  role: string,
  file: SelectedLocalFile,
): string | null {
  for (const [otherRole, state] of Object.entries(inputs)) {
    if (otherRole === role) continue;
    const hit = state.files.find(
      (f) => f.sha256 === file.sha256 || (f.name === file.name && f.size === file.size),
    );
    if (hit) return otherRole;
  }
  return null;
}

export function appendOrReplaceRoleFile(
  current: SelectedWorkflowInput,
  file: SelectedLocalFile,
  allowMultiple: boolean,
): SelectedWorkflowInput {
  if (!allowMultiple) {
    return { role: current.role, files: [file] };
  }
  const withoutDup = current.files.filter((f) => f.sha256 !== file.sha256);
  return { role: current.role, files: [...withoutDup, file] };
}

export function roleAllowsMulti(definition: WorkflowDefinition, role: string): boolean {
  void definition;
  return roleAllowsMultipleFiles(role);
}

export function toExecuteInputFiles(
  definition: WorkflowDefinition,
  inputs: Record<string, SelectedWorkflowInput>,
): Array<{
  role: string;
  path: string;
  sha256: string;
  originalName: string;
  bytes?: Uint8Array;
}> {
  const out: Array<{
    role: string;
    path: string;
    sha256: string;
    originalName: string;
    bytes?: Uint8Array;
  }> = [];
  for (const roleSpec of definition.inputRoles) {
    const files = inputs[roleSpec.role]?.files ?? [];
    for (const file of files) {
      out.push({
        role: roleSpec.role,
        path: file.path,
        sha256: file.sha256,
        originalName: file.name,
        bytes: file.bytes,
      });
    }
  }
  return out;
}

export function assertNoRawRowsInStoragePayload(payload: unknown): void {
  const text = JSON.stringify(payload ?? {});
  if (text.includes('"rows"') && text.includes('"employeeId"')) {
    throw new Error('禁止将原始业务行写入本地存储');
  }
}
