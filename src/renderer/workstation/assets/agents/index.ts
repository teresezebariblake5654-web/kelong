import manufacturingAvatar from './manufacturing.webp';
import hrAvatar from './hr.webp';
import financeAvatar from './finance.webp';
import logisticsAvatar from './logistics.webp';
import ecommerceAvatar from './ecommerce.webp';
import salesAvatar from './sales.webp';

/**
 * 岗位 Q 版人物资源（src/assets/agents/）
 *
 * manufacturing.webp — 生产制造
 * hr.webp            — 人事
 * finance.webp       — 财务
 * logistics.webp     — 物流
 * ecommerce.webp     — 电商
 * sales.webp         — 销售
 */

export type AgentAvatarFile =
  | 'manufacturing.webp'
  | 'hr.webp'
  | 'finance.webp'
  | 'logistics.webp'
  | 'ecommerce.webp'
  | 'sales.webp';

const AVATAR_URLS: Record<AgentAvatarFile, string> = {
  'manufacturing.webp': manufacturingAvatar,
  'hr.webp': hrAvatar,
  'finance.webp': financeAvatar,
  'logistics.webp': logisticsAvatar,
  'ecommerce.webp': ecommerceAvatar,
  'sales.webp': salesAvatar,
};

/** 解析本目录下的人物图 URL */
export function resolveAgentAvatarUrl(filename: string): string | null {
  const normalized = filename.toLowerCase().replace(/\.png$/, '.webp') as AgentAvatarFile;
  if (normalized in AVATAR_URLS) return AVATAR_URLS[normalized];
  const withWebp = `${filename.replace(/\.(webp|png)$/i, '')}.webp` as AgentAvatarFile;
  return AVATAR_URLS[withWebp] ?? null;
}

export const AGENT_AVATAR_FILES = {
  production: 'manufacturing.webp',
  hr: 'hr.webp',
  finance: 'finance.webp',
  logistics: 'logistics.webp',
  ecommerce: 'ecommerce.webp',
  administration: 'sales.webp',
} as const;
