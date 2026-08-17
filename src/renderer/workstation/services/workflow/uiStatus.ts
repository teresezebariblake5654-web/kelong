import type { WorkflowUiStatus } from './types';

export function canStartRun(status: WorkflowUiStatus): boolean {
  return status === 'READY' || status === 'COMPLETED' || status === 'NEEDS_REVIEW' || status === 'FAILED';
}

export function isRunLocked(status: WorkflowUiStatus): boolean {
  return status === 'RUNNING' || status === 'PARSING';
}

export function statusLabel(status: WorkflowUiStatus): string {
  switch (status) {
    case 'IDLE':
      return '等待选择文件';
    case 'PARSING':
      return '正在识别文件';
    case 'READY':
      return '可以运行';
    case 'RUNNING':
      return '正在本地计算';
    case 'NEEDS_REVIEW':
      return '需要人工确认';
    case 'COMPLETED':
      return '已完成';
    case 'FAILED':
      return '运行失败';
    default:
      return status;
  }
}

export function mapResultStatusToUi(
  status: 'COMPLETED' | 'NEEDS_REVIEW' | 'NEEDS_CONFIRMATION' | 'FAILED',
): WorkflowUiStatus {
  if (status === 'FAILED') return 'FAILED';
  if (status === 'NEEDS_REVIEW' || status === 'NEEDS_CONFIRMATION') return 'NEEDS_REVIEW';
  return 'COMPLETED';
}

export function deriveUiStatus(input: {
  hasRequiredFiles: boolean;
  parsing: boolean;
  running: boolean;
  lastResultStatus?: 'COMPLETED' | 'NEEDS_REVIEW' | 'NEEDS_CONFIRMATION' | 'FAILED';
  lastError?: string | null;
}): WorkflowUiStatus {
  if (input.running) return 'RUNNING';
  if (input.parsing) return 'PARSING';
  if (input.lastError && !input.lastResultStatus) return 'FAILED';
  if (input.lastResultStatus) return mapResultStatusToUi(input.lastResultStatus);
  if (input.hasRequiredFiles) return 'READY';
  return 'IDLE';
}
