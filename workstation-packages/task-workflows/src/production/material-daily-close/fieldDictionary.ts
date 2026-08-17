import type { MaterialInputType } from './types.js';

export type StandardFieldKey =
  | 'materialCode'
  | 'materialName'
  | 'specification'
  | 'warehouse'
  | 'batchNo'
  | 'unit'
  | 'openingQuantity'
  | 'inboundQuantity'
  | 'issuedQuantity'
  | 'returnedQuantity'
  | 'scrapQuantity'
  | 'countedQuantity'
  | 'plannedQuantity'
  | 'actualOutputQuantity'
  | 'transactionDate'
  | 'remark';

export type FieldDictionaryEntry = {
  key: StandardFieldKey;
  label: string;
  aliases: string[];
  dataType: 'string' | 'number' | 'date';
};

/** 标准字段别名字典（精确匹配用） */
export const FIELD_DICTIONARY: readonly FieldDictionaryEntry[] = [
  {
    key: 'materialCode',
    label: '物料编码',
    aliases: ['物料编码', '物料号', '材料编码', '料号', '存货编码', 'SKU', '物料编号', '物料代码', '品号'],
    dataType: 'string',
  },
  {
    key: 'materialName',
    label: '物料名称',
    aliases: ['物料名称', '材料名称', '品名', '存货名称', '物料', '原料', '物料描述'],
    dataType: 'string',
  },
  {
    key: 'specification',
    label: '规格型号',
    aliases: ['规格型号', '规格', '型号', '规格描述', '材质规格'],
    dataType: 'string',
  },
  {
    key: 'warehouse',
    label: '仓库',
    aliases: ['仓库', '库位', '仓位', '存放位置', '仓库名称', '库房'],
    dataType: 'string',
  },
  {
    key: 'batchNo',
    label: '批次号',
    aliases: ['批次号', '批号', '批次', '生产批次', 'LOT', 'Lot'],
    dataType: 'string',
  },
  {
    key: 'unit',
    label: '单位',
    aliases: ['单位', '计量单位', 'UOM', '单位名称'],
    dataType: 'string',
  },
  {
    key: 'openingQuantity',
    label: '期初库存',
    aliases: ['期初库存', '昨日库存', '账面库存', '库存数量', '期初', '期初数量', '昨日结存', '期初结存', '当前库存'],
    dataType: 'number',
  },
  {
    key: 'inboundQuantity',
    label: '入库数量',
    aliases: ['入库数量', '入库', '收料', '进料', '领入', '采购入库', '入仓数量'],
    dataType: 'number',
  },
  {
    key: 'issuedQuantity',
    label: '领料数量',
    aliases: ['领料数量', '出库数量', '实领数量', '领用数量', '领用量', '发料', '出库', '领用', '发料数量', '今日领料'],
    dataType: 'number',
  },
  {
    key: 'returnedQuantity',
    label: '退料数量',
    aliases: ['退料数量', '退回数量', '返库数量', '退料', '退库', '退料量', '今日退料'],
    dataType: 'number',
  },
  {
    key: 'scrapQuantity',
    label: '废料数量',
    aliases: ['废料数量', '报废数量', '损耗数量', '不良数量', '废料', '报废', '损耗', '废品', '今日废料', '报废量'],
    dataType: 'number',
  },
  {
    key: 'countedQuantity',
    label: '实盘数量',
    aliases: ['盘点数量', '实盘数量', '实存数量', '实盘', '账面实存', '盘存', '实际库存', '盘点实数'],
    dataType: 'number',
  },
  {
    key: 'plannedQuantity',
    label: '计划数量',
    aliases: ['计划数量', '计划产量', '工单数量', '计划数', '目标产量', '计划需求'],
    dataType: 'number',
  },
  {
    key: 'actualOutputQuantity',
    label: '实际完工数量',
    aliases: ['实际完工数量', '完工数量', '实际产量', '完成数量', '报工数量', '产量'],
    dataType: 'number',
  },
  {
    key: 'transactionDate',
    label: '业务日期',
    aliases: ['业务日期', '日期', '盘点日期', '日清日期', '记账日期', '领料日期', '报废日期', '单据日期'],
    dataType: 'date',
  },
  {
    key: 'remark',
    label: '备注',
    aliases: ['备注', '说明', '备注说明', '异常说明'],
    dataType: 'string',
  },
] as const;

export const CRITICAL_FIELDS_BY_TYPE: Record<MaterialInputType, StandardFieldKey[]> = {
  inventory: ['materialName', 'openingQuantity'],
  materialIssue: ['materialName', 'issuedQuantity'],
  materialReturn: ['materialName', 'returnedQuantity'],
  scrap: ['materialName', 'scrapQuantity'],
  productionPlan: ['materialName', 'plannedQuantity'],
};

export const TYPE_HINTS: Record<
  MaterialInputType,
  { fileNameKeywords: string[]; sheetKeywords: string[]; headerBoostFields: StandardFieldKey[] }
> = {
  inventory: {
    fileNameKeywords: ['库存', '盘点', '日清', '结存', 'inventory', 'stock'],
    sheetKeywords: ['库存', '盘点', '日清', '结存', 'inventory'],
    headerBoostFields: ['openingQuantity', 'countedQuantity'],
  },
  materialIssue: {
    fileNameKeywords: ['领料', '发料', '出库', 'issue', 'picking'],
    sheetKeywords: ['领料', '发料', '出库'],
    headerBoostFields: ['issuedQuantity'],
  },
  materialReturn: {
    fileNameKeywords: ['退料', '退库', 'return'],
    sheetKeywords: ['退料', '退库'],
    headerBoostFields: ['returnedQuantity'],
  },
  scrap: {
    fileNameKeywords: ['废料', '报废', 'scrap', 'waste'],
    sheetKeywords: ['废料', '报废'],
    headerBoostFields: ['scrapQuantity'],
  },
  productionPlan: {
    fileNameKeywords: ['计划', '完工', '产量', '报工', 'production', 'plan'],
    sheetKeywords: ['计划', '完工', '产量', '报工'],
    headerBoostFields: ['plannedQuantity', 'actualOutputQuantity'],
  },
};

export function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function getFieldEntry(key: StandardFieldKey): FieldDictionaryEntry {
  const found = FIELD_DICTIONARY.find((item) => item.key === key);
  if (!found) throw new Error(`未知标准字段: ${key}`);
  return found;
}

export const ALL_STANDARD_FIELD_KEYS = FIELD_DICTIONARY.map((item) => item.key);
