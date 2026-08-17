import type { EnterpriseRules } from '../enterpriseRules.js';
import { EnterpriseRulesSchema } from '../enterpriseRules.js';
import type { StandardFieldKey } from '../fieldDictionary.js';
import type { FieldMappingRecord, LocalHistoryStore } from '../localHistory.js';
import type { MaterialCloseRepository } from './types.js';

/** 将 SQLite 仓库适配为既有 LocalHistoryStore（字段映射 + 企业规则） */
export function createHistoryStoreFromRepository(
  repo: MaterialCloseRepository,
  workspaceId: string,
): LocalHistoryStore {
  return {
    listMappings() {
      return repo.listFieldMappings(workspaceId).map(
        (row) =>
          ({
            scopeKey: workspaceId,
            headerFingerprint: row.headerFingerprint,
            mappings: JSON.parse(row.mappingsJson) as Partial<Record<StandardFieldKey, string>>,
            updatedAt: row.updatedAt,
          }) satisfies FieldMappingRecord,
      );
    },
    saveMapping(record) {
      repo.saveFieldMapping({
        workspaceId,
        headerFingerprint: record.headerFingerprint,
        mappings: record.mappings as Record<string, string>,
      });
    },
    getEnterpriseRules() {
      const profile = repo.getRuleProfile(workspaceId);
      if (!profile) return null;
      try {
        return EnterpriseRulesSchema.parse({
          safetyStockByMaterial: JSON.parse(profile.safetyStockJson || '{}'),
          defaultSafetyStock: 0,
          scrapRatioThreshold: profile.scrapRatioThreshold,
          quantityTolerance: profile.quantityTolerance,
          aiConfidenceThreshold: profile.aiConfidenceThreshold,
          unitConversion: JSON.parse(profile.unitConversionJson || '{}'),
          warehouseAlias: JSON.parse(profile.warehouseAliasJson || '{}'),
          updatedAt: profile.updatedAt,
        });
      } catch {
        return null;
      }
    },
    saveEnterpriseRules(_scopeKey, rules: EnterpriseRules) {
      const parsed = EnterpriseRulesSchema.parse(rules);
      repo.saveRuleProfile({
        workspaceId,
        safetyStockJson: JSON.stringify(parsed.safetyStockByMaterial ?? {}),
        scrapRatioThreshold: parsed.scrapRatioThreshold,
        quantityTolerance: parsed.quantityTolerance,
        unitConversionJson: JSON.stringify(parsed.unitConversion ?? {}),
        warehouseAliasJson: JSON.stringify(parsed.warehouseAlias ?? {}),
        aiConfidenceThreshold: parsed.aiConfidenceThreshold,
      });
    },
  };
}
