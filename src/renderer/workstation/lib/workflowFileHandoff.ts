import type { SelectedLocalFile } from '@workstation/services/workflow/types';

type HandoffPayload = {
  workflowId: string;
  files: SelectedLocalFile[];
  source: 'department-chat';
  createdAt: number;
};

let pending: HandoffPayload | null = null;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Convert browser File objects into workflow SelectedLocalFile payloads. */
export async function filesToWorkflowInputs(files: File[]): Promise<SelectedLocalFile[]> {
  const out: SelectedLocalFile[] = [];
  for (const file of files) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!/^(xlsx|xls|csv)$/.test(ext)) continue;
    const buffer = new Uint8Array(await file.arrayBuffer());
    const sha256 = await sha256Hex(buffer);
    out.push({
      name: file.name,
      path: `memory://${file.name}`,
      size: file.size,
      sha256,
      bytes: buffer,
      extension: ext,
    });
  }
  return out;
}

/** Stash chat uploads so WorkflowRunPage can pick them up after navigation. */
export function stashWorkflowHandoffFiles(
  workflowId: string,
  files: SelectedLocalFile[],
): void {
  if (!workflowId || !files.length) {
    pending = null;
    return;
  }
  pending = {
    workflowId,
    files,
    source: 'department-chat',
    createdAt: Date.now(),
  };
}

/** Consume one-shot handoff for a workflow page (clears after read). */
export function takeWorkflowHandoffFiles(workflowId: string): SelectedLocalFile[] {
  if (!pending || pending.workflowId !== workflowId) return [];
  const files = pending.files;
  pending = null;
  return files;
}
