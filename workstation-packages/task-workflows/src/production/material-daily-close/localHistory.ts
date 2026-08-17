import type { StandardFieldKey } from './fieldDictionary.js';
import type { EnterpriseRules } from './enterpriseRules.js';
import { DEFAULT_ENTERPRISE_RULES, EnterpriseRulesSchema } from './enterpriseRules.js';

export type FieldMappingRecord = {
  /** 组织或设备维度 key，桌面端可用 orgId / deviceId */
  scopeKey: string;
  /** 表头指纹：排序后的 headers join */
  headerFingerprint: string;
  mappings: Partial<Record<StandardFieldKey, string>>;
  updatedAt: string;
};

export type LocalHistoryStore = {
  listMappings(scopeKey: string): FieldMappingRecord[];
  saveMapping(record: FieldMappingRecord): void;
  getEnterpriseRules(scopeKey: string): EnterpriseRules | null;
  saveEnterpriseRules(scopeKey: string, rules: EnterpriseRules): void;
};

/** 内存实现（测试 / SSR）；桌面端注入 localStorage 适配器 */
export function createMemoryHistoryStore(): LocalHistoryStore {
  const mappings = new Map<string, FieldMappingRecord[]>();
  const rules = new Map<string, EnterpriseRules>();
  return {
    listMappings(scopeKey) {
      return mappings.get(scopeKey) ?? [];
    },
    saveMapping(record) {
      const list = mappings.get(record.scopeKey) ?? [];
      const next = list.filter((item) => item.headerFingerprint !== record.headerFingerprint);
      next.unshift(record);
      mappings.set(record.scopeKey, next.slice(0, 100));
    },
    getEnterpriseRules(scopeKey) {
      return rules.get(scopeKey) ?? null;
    },
    saveEnterpriseRules(scopeKey, next) {
      rules.set(scopeKey, EnterpriseRulesSchema.parse(next));
    },
  };
}

export function headerFingerprint(headers: string[]): string {
  return [...headers].map((h) => h.trim()).filter(Boolean).sort().join('|');
}

export function findHistoricalMapping(
  store: LocalHistoryStore,
  scopeKey: string,
  headers: string[],
): FieldMappingRecord | null {
  const fp = headerFingerprint(headers);
  const list = store.listMappings(scopeKey);
  const exact = list.find((item) => item.headerFingerprint === fp);
  if (exact) return exact;

  // partial reuse: mapping columns still present
  for (const item of list) {
    const values = Object.values(item.mappings);
    if (values.length && values.every((col) => col && headers.includes(col))) {
      return item;
    }
  }
  return null;
}

export function saveConfirmedMappings(
  store: LocalHistoryStore,
  scopeKey: string,
  headers: string[],
  mappings: Partial<Record<StandardFieldKey, string>>,
) {
  store.saveMapping({
    scopeKey,
    headerFingerprint: headerFingerprint(headers),
    mappings,
    updatedAt: new Date().toISOString(),
  });
}

export function loadOrDefaultRules(store: LocalHistoryStore, scopeKey: string): EnterpriseRules {
  return store.getEnterpriseRules(scopeKey) ?? { ...DEFAULT_ENTERPRISE_RULES };
}
