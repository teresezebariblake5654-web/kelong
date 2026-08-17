import type { WorkflowCatalog, WorkflowDefinition } from '@aw/shared';
import catalogJson from './catalog.v1.json';

const catalog = catalogJson as WorkflowCatalog;

function assertCatalogShape(value: WorkflowCatalog): void {
  if (!value || typeof value !== 'object') {
    throw new Error('Workflow catalog is empty');
  }
  if (!value.schemaVersion || !value.catalogId || !Array.isArray(value.workflows)) {
    throw new Error('Workflow catalog missing schemaVersion/catalogId/workflows');
  }
  for (const workflow of value.workflows) {
    if (!workflow.id || !workflow.name || !Array.isArray(workflow.inputRoles)) {
      throw new Error(`Invalid workflow definition: ${workflow.id || '(missing id)'}`);
    }
    if (!workflow.output?.fileNameTemplate || !Array.isArray(workflow.output.sheets)) {
      throw new Error(`Workflow ${workflow.id} missing output specification`);
    }
  }
}

assertCatalogShape(catalog);

export const WORKFLOW_CATALOG_VERSION = catalog.schemaVersion;
export const WORKFLOW_CATALOG_ID = catalog.catalogId;

export function getWorkflowCatalog(): WorkflowCatalog {
  return catalog;
}

export function listWorkflowDefinitions(options?: {
  category?: WorkflowDefinition['category'];
  deliveryWave?: WorkflowDefinition['deliveryWave'];
}): WorkflowDefinition[] {
  return catalog.workflows.filter((workflow) => {
    if (options?.category && workflow.category !== options.category) return false;
    if (options?.deliveryWave && workflow.deliveryWave !== options.deliveryWave) return false;
    return true;
  });
}

export function getWorkflowDefinition(workflowId: string): WorkflowDefinition | undefined {
  return catalog.workflows.find((workflow) => workflow.id === workflowId);
}

export function requireWorkflowDefinition(workflowId: string): WorkflowDefinition {
  const definition = getWorkflowDefinition(workflowId);
  if (!definition) {
    throw new Error(`Unknown workflowId: ${workflowId}`);
  }
  return definition;
}
