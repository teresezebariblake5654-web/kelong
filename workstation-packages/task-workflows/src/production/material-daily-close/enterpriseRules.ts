import { z } from 'zod';

/** 本地企业规则（安全库存、损耗阈值、单位换算、仓库别名、AI 置信度） */
export const EnterpriseRulesSchema = z.object({
  safetyStockByMaterial: z.record(z.string(), z.number().nonnegative()).default({}),
  defaultSafetyStock: z.number().nonnegative().default(0),
  scrapRatioThreshold: z.number().min(0).max(1).default(0.05),
  quantityTolerance: z.number().nonnegative().default(0.001),
  aiConfidenceThreshold: z.number().min(0).max(1).default(0.7),
  /** 单位换算：源单位 → { to, factor }，如 { KG: { to: 'G', factor: 1000 } } */
  unitConversion: z
    .record(z.string(), z.object({ to: z.string(), factor: z.number().positive() }))
    .default({}),
  /** 仓库别名 → 标准仓库名 */
  warehouseAlias: z.record(z.string(), z.string()).default({}),
  updatedAt: z.string().optional(),
});

export type EnterpriseRules = z.infer<typeof EnterpriseRulesSchema>;

export const DEFAULT_ENTERPRISE_RULES: EnterpriseRules = {
  safetyStockByMaterial: {},
  defaultSafetyStock: 0,
  scrapRatioThreshold: 0.05,
  quantityTolerance: 0.001,
  aiConfidenceThreshold: 0.7,
  unitConversion: {},
  warehouseAlias: {},
};

export type EnterpriseRuleQuestion = {
  id: 'defaultSafetyStock' | 'scrapRatioThreshold' | 'quantityTolerance' | 'aiConfidenceThreshold';
  message: string;
  defaultValue: number;
  unitHint: string;
};

/** 首次无规则时只询问少量必要值 */
export function getBootstrapRuleQuestions(existing?: Partial<EnterpriseRules> | null): EnterpriseRuleQuestion[] {
  if (existing && Object.keys(existing).length > 0) return [];
  return [
    {
      id: 'defaultSafetyStock',
      message: '默认安全库存数量（无物料级配置时使用）',
      defaultValue: 0,
      unitHint: '数量',
    },
    {
      id: 'scrapRatioThreshold',
      message: '报废/损耗占领料比例上限（超过则告警）',
      defaultValue: 0.05,
      unitHint: '比例，如 0.05=5%',
    },
    {
      id: 'quantityTolerance',
      message: '数量比较容差（账实差异忽略阈值）',
      defaultValue: 0.001,
      unitHint: '数量',
    },
  ];
}

export function mergeEnterpriseRules(
  base: EnterpriseRules,
  patch: Partial<EnterpriseRules>,
): EnterpriseRules {
  return EnterpriseRulesSchema.parse({
    ...base,
    ...patch,
    safetyStockByMaterial: {
      ...base.safetyStockByMaterial,
      ...(patch.safetyStockByMaterial ?? {}),
    },
    unitConversion: {
      ...base.unitConversion,
      ...(patch.unitConversion ?? {}),
    },
    warehouseAlias: {
      ...base.warehouseAlias,
      ...(patch.warehouseAlias ?? {}),
    },
    updatedAt: new Date().toISOString(),
  });
}

export function resolveSafetyStock(rules: EnterpriseRules, materialCode: string, materialName: string): number {
  if (materialCode && rules.safetyStockByMaterial[materialCode] !== undefined) {
    return rules.safetyStockByMaterial[materialCode]!;
  }
  if (materialName && rules.safetyStockByMaterial[materialName] !== undefined) {
    return rules.safetyStockByMaterial[materialName]!;
  }
  return rules.defaultSafetyStock;
}
