import type { ChatAgentCode } from '@aw/shared';
import type { AgentConfig, AgentWorkMode } from '@workstation/data/agentConfigs';
import type { DepartmentCode } from '@workstation/data/departmentAgents';

const DEPARTMENT_CHAT_AGENT: Record<DepartmentCode, ChatAgentCode> = {
  production: 'production',
  hr: 'hr',
  finance: 'finance',
  logistics: 'logistics',
  ecommerce: 'ecommerce',
  administration: 'admin',
  marketing: 'sales',
  sales: 'sales',
  procurement: 'data-analysis',
  operations: 'data-analysis',
};

export function departmentToChatAgentCode(code: DepartmentCode): ChatAgentCode {
  return DEPARTMENT_CHAT_AGENT[code] ?? 'general';
}

/** 根据快捷建议文案匹配工作模式（技能） */
export function matchWorkModeByQuickTask(
  modes: AgentWorkMode[],
  text: string,
): AgentWorkMode | undefined {
  const q = text.trim().toLowerCase();
  if (!q) return undefined;

  const scored = modes
    .map((mode) => {
      const hay = `${mode.name}${mode.description}${mode.id}`.toLowerCase();
      let score = 0;
      if (q.includes(mode.name.toLowerCase()) || mode.name.toLowerCase().includes(q.slice(0, 4))) {
        score += 5;
      }
      for (const token of mode.name) {
        if (token.length >= 2 && q.includes(token)) score += 1;
      }
      if (/工资|薪酬|payroll/.test(q) && /工资|薪酬|payroll/.test(hay)) score += 8;
      if (/考勤|迟到|缺勤/.test(q) && /考勤/.test(hay)) score += 8;
      if (/档案|编制|入职|离职/.test(q) && /档案|入职|离职|流动/.test(hay)) score += 6;
      if (/社保|公积金/.test(q) && /社保/.test(hay)) score += 8;
      if (/物料|日清|消耗/.test(q) && /物料|消耗|日清/.test(hay)) score += 8;
      if (/费用|对账|应收|应付/.test(q) && /费用|对账|应收|应付/.test(hay)) score += 8;
      if (/库存|出入库|调拨|物流/.test(q) && /库存|出入|调拨|物流/.test(hay)) score += 8;
      if (/订单|退款|电商|直播/.test(q) && /订单|退款|直播|销售/.test(hay)) score += 8;
      if (/资产|合同|会议|行政/.test(q) && /资产|合同|会议|行政/.test(hay)) score += 6;
      return { mode, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.mode;
}

export function buildDepartmentChatContext(input: {
  config: AgentConfig;
  mode?: AgentWorkMode;
  spreadsheetPreview?: string;
}): string {
  const lines = [
    `当前智能体：${input.config.name}智能体`,
    input.config.slogan ? `定位：${input.config.slogan}` : '',
    input.mode
      ? `当前选中技能/工作模式：${input.mode.name}（${input.mode.description}）`
      : '当前未锁定具体工作模式，可按用户意图选择合适技能。',
    '你可以直接读取用户上传的完整表格明细（见下方），在对话中完成分析、核对、汇总，并用 Markdown 表格输出结果；不要把用户支到其他「本地精算」页面。',
    '若提示中标明表格被截断，请明确告知用户当前聊天未能载入全部明细，并说明已读到的范围与建议（拆表/缩小范围后重传）。',
    '输出格式：差异/清单/对比/汇总类结论必须使用 Markdown 表格（表头 + |---| 分隔行 + 数据行），结构建议为「一句话结论 → Markdown 表格 → 建议下一步」。用户可点击「保存表格」导出 Excel。',
    input.spreadsheetPreview
      ? `用户已上传表格，以下为聊天可读入的明细（请基于此作答，勿编造未出现的数字）：\n${input.spreadsheetPreview}`
      : '用户尚未提供可解析的表格；若问题依赖明细数据，请明确需要上传哪些 Excel/CSV 及关键字段。',
  ];
  return lines.filter(Boolean).join('\n');
}
