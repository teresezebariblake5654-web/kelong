export class LeadTaskCancelledError extends Error {
  readonly code = 'LEAD_TASK_CANCELLED';
  partial?: unknown;
  constructor(message = 'Lead search task cancelled', partial?: unknown) {
    super(message);
    this.name = 'LeadTaskCancelledError';
    this.partial = partial;
  }
}

export function isLeadTaskCancelledError(err: unknown): err is LeadTaskCancelledError {
  if (err instanceof LeadTaskCancelledError) return true;
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string };
  return e.name === 'LeadTaskCancelledError' || e.code === 'LEAD_TASK_CANCELLED';
}
