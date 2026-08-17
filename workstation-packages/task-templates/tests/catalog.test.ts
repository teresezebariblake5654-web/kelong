import { describe, expect, it } from 'vitest';
import {
  AGENT_ROLES,
  LOCAL_TASK_TEMPLATES,
  PRODUCT_ROLE_ACCESS,
  getTaskTemplate,
  listTasksByProduct,
  listTasksByRole,
} from '../src/index.js';

describe('task template catalog', () => {
  it('provides executable templates for all ten roles', () => {
    expect(AGENT_ROLES).toHaveLength(10);
    for (const role of AGENT_ROLES) {
      expect(listTasksByRole(role).length, role).toBeGreaterThan(0);
    }
    expect(listTasksByRole('marketing')).toHaveLength(4);
    expect(listTasksByRole('administration')).toHaveLength(4);
  });

  it('uses a unique code and version pair', () => {
    const identities = LOCAL_TASK_TEMPLATES.map(({ code, version }) => `${code}@${version}`);
    expect(new Set(identities).size).toBe(identities.length);
  });

  it('gives every field usable aliases and validates rule structure', () => {
    for (const template of LOCAL_TASK_TEMPLATES) {
      const required = template.fields.filter((field) => field.required);
      expect(required.length, template.code).toBeGreaterThan(0);
      for (const field of template.fields) {
        expect(field.aliases.length, `${template.code}:${field.key}`).toBeGreaterThan(1);
        expect(field.aliases).toContain(field.label);
        if (field.required) {
          expect(template.requiredFields).toContain(field.label);
        }
      }
      for (const operation of template.localOperations) {
        expect(['filter', 'group', 'aggregate', 'derive', 'sort', 'deduplicate', 'limit']).toContain(operation.type);
      }
      for (const rule of template.anomalyRules) {
        expect(rule.code).toMatch(/^[A-Z][A-Z0-9_]+$/);
        expect(rule.name).not.toHaveLength(0);
        expect(rule.field).not.toHaveLength(0);
        expect(rule.message).not.toHaveLength(0);
        expect(['info', 'warning', 'critical']).toContain(rule.severity);
      }
    }
  });

  it('maps product permissions to the required roles', () => {
    expect(PRODUCT_ROLE_ACCESS.HR_AGENT).toEqual(['hr', 'universal']);
    expect(PRODUCT_ROLE_ACCESS.SALES_AGENT).toEqual(['sales', 'universal']);
    expect(PRODUCT_ROLE_ACCESS.BUSINESS_AGENT).toEqual(['marketing', 'sales', 'operations', 'universal']);
    expect(PRODUCT_ROLE_ACCESS.MANUFACTURING_AGENT).toEqual(['procurement', 'production', 'logistics', 'universal']);
    expect(PRODUCT_ROLE_ACCESS.FULL_AGENT).toEqual(AGENT_ROLES);
    expect(PRODUCT_ROLE_ACCESS.PRODUCTION_AGENT).toEqual(['production', 'universal']);
    expect(PRODUCT_ROLE_ACCESS.LOGISTICS_AGENT).toEqual(['logistics', 'universal']);
    expect(PRODUCT_ROLE_ACCESS.UNIVERSAL_AGENT).toEqual(['universal']);
    expect(listTasksByProduct('HR_AGENT').every(({ role }) => role === 'hr' || role === 'universal')).toBe(true);
  });

  it('keeps every template complete and backward compatible', () => {
    for (const template of LOCAL_TASK_TEMPLATES) {
      expect(template.localOperations.length, template.code).toBeGreaterThan(0);
      expect(template.anomalyRules.length, template.code).toBeGreaterThan(0);
      expect(template.structuredOutputSchema.required).toEqual(expect.arrayContaining(['summary', 'metrics', 'anomalies']));
      expect(template.reportSections.length, template.code).toBeGreaterThan(0);
      expect(template.creditCost).toBeGreaterThan(0);
      expect(template.estimatedCredits).toBe(template.creditCost);
      expect(template.enabled).toBe(true);
      expect(template.aiSummary.promptTemplate).toContain('{{structuredOutput}}');
      expect(template.reportExport.formats).toContain('xlsx');
      expect(template.allowedProductTypes.length, template.code).toBeGreaterThan(0);
      expect(getTaskTemplate(template.code, template.version)).toBe(template);
    }
  });
});
