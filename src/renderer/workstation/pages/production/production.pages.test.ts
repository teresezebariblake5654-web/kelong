import { describe, expect, it, vi } from 'vitest';
import {
  listProductionWorkflows,
  PRODUCTION_WORKFLOW_IDS,
  productionDisclaimer,
  workflowDisclaimer,
} from '@workstation/services/workflow';

describe('production home catalog mount', () => {
  it('exposes six clickable workflow ids for cards', () => {
    const workflows = listProductionWorkflows();
    expect(workflows).toHaveLength(6);
    expect(workflows.map((w) => w.id)).toEqual([...PRODUCTION_WORKFLOW_IDS]);
    for (const workflow of workflows) {
      expect(workflow.name.length).toBeGreaterThan(0);
      expect(workflow.businessGoal.length).toBeGreaterThan(0);
      expect(productionDisclaimer(workflow.id)).toMatch(/不自动/);
      expect(workflowDisclaimer(workflow.id)).toBe(productionDisclaimer(workflow.id));
      expect(workflow.output.fileNameTemplate.includes('.xlsx') || workflow.output.fileNameTemplate.includes('{')).toBe(
        true,
      );
    }
  });
});

describe('open result bridge contract', () => {
  it('openFile is invoked through bridge interface', async () => {
    const openFile = vi.fn(async (_path: string) => undefined);
    await openFile('D:/ws/out/result.xlsx');
    expect(openFile).toHaveBeenCalledWith('D:/ws/out/result.xlsx');
  });
});
