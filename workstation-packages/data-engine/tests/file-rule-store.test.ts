import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileRuleStore, RULE_STORE_SCHEMA_VERSION } from '../src/index.js';

describe('FileRuleStore', () => {
  it('saves and reloads workflow-isolated rules with schema validation', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aw-rules-'));
    const store = createFileRuleStore({ rootDir });

    await store.saveWorkflowRules('demo-company', 'PROD-CONSUMPTION-CHECK-002', {
      defaultLossRate: 0.03,
      overuseToleranceRate: 0.05,
      underuseToleranceRate: 0.05,
      allowSubstituteMaterial: false,
    });

    const loaded = await store.load('demo-company');
    expect(loaded.schemaVersion).toBe(RULE_STORE_SCHEMA_VERSION);
    expect(loaded.companyId).toBe('demo-company');
    expect((loaded.workflows as Record<string, Record<string, unknown>>)['PROD-CONSUMPTION-CHECK-002'])
      .toMatchObject({ defaultLossRate: 0.03 });

    const path = join(rootDir, 'company-rules', 'demo-company.json');
    expect(existsSync(path)).toBe(true);
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      workflows: Record<string, unknown>;
    };
    expect(JSON.stringify(raw)).not.toMatch(/workOrderNo|Excel|xlsx|员工|客户/);
    expect(Object.keys(raw.workflows)).toEqual(['PROD-CONSUMPTION-CHECK-002']);

    await expect(
      store.save('demo-company', { schemaVersion: '9.9', workflows: {} }),
    ).rejects.toThrow(/schemaVersion/);
  });

  it('isolates companies and workflows', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aw-rules-iso-'));
    const store = createFileRuleStore({ rootDir });
    await store.saveWorkflowRules('c1', 'PROD-CONSUMPTION-CHECK-002', { defaultLossRate: 0.01 });
    await store.saveWorkflowRules('c2', 'PROD-CONSUMPTION-CHECK-002', { defaultLossRate: 0.09 });
    await store.saveWorkflowRules('c1', 'PROD-MATERIAL-DAILY-001', {
      'materialDaily.toleranceQty': 2,
    });

    expect(await store.getWorkflowRules('c1', 'PROD-CONSUMPTION-CHECK-002')).toMatchObject({
      defaultLossRate: 0.01,
    });
    expect(await store.getWorkflowRules('c2', 'PROD-CONSUMPTION-CHECK-002')).toMatchObject({
      defaultLossRate: 0.09,
    });
    expect(await store.getWorkflowRules('c1', 'PROD-MATERIAL-DAILY-001')).toMatchObject({
      'materialDaily.toleranceQty': 2,
    });
  });
});
