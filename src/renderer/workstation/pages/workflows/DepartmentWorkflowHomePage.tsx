import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, FolderOpen, HardDrive } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageBackButton } from '@workstation/components/layout/PageBackButton';
import {
  departmentHomePath,
  departmentRunPath,
  getDesktopWorkflowBridge,
  isHighRiskWorkflow,
  listDepartmentWorkflows,
  optionalInputCount,
  requiredInputCount,
  sampleOutputFileName,
  sensitivityLabel,
  sensitivityLevel,
  workflowDisclaimer,
  type DepartmentWorkflowCategory,
  type LocalWorkspaceConfig,
} from '@workstation/services/workflow';
import { cn } from '@workstation/lib/utils';

const THEME: Record<
  DepartmentWorkflowCategory,
  {
    accent: string;
    accentSoft: string;
    label: string;
    title: string;
    border: string;
    text: string;
    softBg: string;
    hoverBorder: string;
    buttonBorder: string;
    buttonText: string;
    buttonHover: string;
    chipBg: string;
    chipText: string;
    link: string;
    back: string;
  }
> = {
  production: {
    accent: '#22C55E',
    accentSoft: '#ECFDF5',
    label: '生产制造智能体',
    title: '选择生产任务',
    border: 'border-emerald-100',
    text: 'text-emerald-700',
    softBg: 'from-emerald-50',
    hoverBorder: 'hover:border-emerald-300',
    buttonBorder: 'border-emerald-200',
    buttonText: 'text-emerald-800',
    buttonHover: 'hover:bg-emerald-50',
    chipBg: '#22C55E18',
    chipText: '#166534',
    link: 'text-emerald-700',
    back: '/templates/production',
  },
  hr: {
    accent: '#4F46E5',
    accentSoft: '#EEF2FF',
    label: '人事智能体',
    title: '选择人事任务',
    border: 'border-indigo-100',
    text: 'text-indigo-700',
    softBg: 'from-indigo-50',
    hoverBorder: 'hover:border-indigo-300',
    buttonBorder: 'border-indigo-200',
    buttonText: 'text-indigo-800',
    buttonHover: 'hover:bg-indigo-50',
    chipBg: '#4F46E518',
    chipText: '#3730A3',
    link: 'text-indigo-700',
    back: '/templates/hr',
  },
  finance: {
    accent: '#2563EB',
    accentSoft: '#EFF6FF',
    label: '财务智能体',
    title: '选择财务任务',
    border: 'border-sky-100',
    text: 'text-sky-700',
    softBg: 'from-sky-50',
    hoverBorder: 'hover:border-sky-300',
    buttonBorder: 'border-sky-200',
    buttonText: 'text-sky-800',
    buttonHover: 'hover:bg-sky-50',
    chipBg: '#2563EB18',
    chipText: '#1E40AF',
    link: 'text-sky-700',
    back: '/templates/finance',
  },
  ecommerce: {
    accent: '#DB2777',
    accentSoft: '#FDF2F8',
    label: '电商智能体',
    title: '选择电商任务',
    border: 'border-pink-100',
    text: 'text-pink-700',
    softBg: 'from-pink-50',
    hoverBorder: 'hover:border-pink-300',
    buttonBorder: 'border-pink-200',
    buttonText: 'text-pink-800',
    buttonHover: 'hover:bg-pink-50',
    chipBg: '#DB277718',
    chipText: '#9D174D',
    link: 'text-pink-700',
    back: '/templates/ecommerce',
  },
  logistics: {
    accent: '#F97316',
    accentSoft: '#FFF7ED',
    label: '物流智能体',
    title: '选择物流任务',
    border: 'border-orange-100',
    text: 'text-orange-700',
    softBg: 'from-orange-50',
    hoverBorder: 'hover:border-orange-300',
    buttonBorder: 'border-orange-200',
    buttonText: 'text-orange-800',
    buttonHover: 'hover:bg-orange-50',
    chipBg: '#F9731618',
    chipText: '#C2410C',
    link: 'text-orange-700',
    back: '/templates/logistics',
  },
  admin: {
    accent: '#64748B',
    accentSoft: '#F8FAFC',
    label: '行政智能体',
    title: '选择行政任务',
    border: 'border-slate-200',
    text: 'text-slate-700',
    softBg: 'from-slate-50',
    hoverBorder: 'hover:border-slate-300',
    buttonBorder: 'border-slate-200',
    buttonText: 'text-slate-800',
    buttonHover: 'hover:bg-slate-50',
    chipBg: '#64748B18',
    chipText: '#334155',
    link: 'text-slate-700',
    back: '/templates/administration',
  },
} as const;

export type DepartmentWorkflowHomePageProps = {
  category: DepartmentWorkflowCategory;
};

export function DepartmentWorkflowHomePage({ category }: DepartmentWorkflowHomePageProps) {
  const navigate = useNavigate();
  const theme = THEME[category];
  const workflows = listDepartmentWorkflows(category);
  const bridge = getDesktopWorkflowBridge();
  const [workspace, setWorkspace] = useState<LocalWorkspaceConfig | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    void bridge.getWorkspaceConfig().then(setWorkspace);
  }, [bridge]);

  async function onSelectWorkspace() {
    try {
      const dir = await bridge.selectWorkspaceDirectory();
      if (dir) {
        const next = await bridge.getWorkspaceConfig();
        setWorkspace(next);
        setMessage(`已设置工作区：${next.rootDir}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '工作区选择失败');
    }
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-6">
      <header
        className={cn(
          'rounded-[24px] border bg-gradient-to-br via-white to-white p-6 shadow-[0_12px_32px_-24px_rgba(15,23,42,0.35)]',
          theme.border,
          theme.softBg,
        )}
      >
        <div className="mb-3">
          <PageBackButton
            onBack={() => navigate(theme.back)}
            label="返回工作站"
          />
        </div>
        <p className={cn('text-sm font-medium', theme.text)}>{theme.label}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{theme.title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
          选择任务后，在本机选择表格文件，确认公司规则，即可生成本地结果。原始业务数据不会上传。
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void onSelectWorkspace()}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border bg-white px-4 py-2 text-sm font-medium',
              theme.buttonBorder,
              theme.buttonText,
              theme.buttonHover,
            )}
          >
            <HardDrive className="size-4" />
            选择工作区 / U 盘
          </button>
          {workspace ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <FolderOpen className="size-3.5" />
              当前工作区：{workspace.rootDir} · 公司 {workspace.companyId}
            </span>
          ) : null}
        </div>
        {message ? <p className="mt-2 text-xs text-slate-500">{message}</p> : null}
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {workflows.map((workflow) => {
          const highRisk = isHighRiskWorkflow(workflow);
          const level = sensitivityLevel(workflow);
          const required = requiredInputCount(workflow);
          const optional = optionalInputCount(workflow);
          const disclaimer = workflowDisclaimer(workflow.id);
          return (
            <Link
              key={workflow.id}
              to={departmentRunPath(category, workflow.id)}
              className={cn(
                'group flex flex-col rounded-[20px] border border-slate-200/90 bg-white/95 p-5',
                'shadow-[0_8px_24px_-20px_rgba(15,23,42,0.3)] transition hover:-translate-y-0.5',
                theme.hoverBorder,
              )}
              style={{ background: `linear-gradient(180deg, ${theme.accentSoft}55 0%, #fff 42%)` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{workflow.name}</h2>
                  <p className="mt-1 text-xs text-slate-400">{workflow.id}</p>
                </div>
                <ChevronRight className="size-5 shrink-0 text-slate-300 transition group-hover:opacity-100" />
              </div>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-600">{workflow.businessGoal}</p>
              {disclaimer ? (
                <p className="mt-2 rounded-lg border border-amber-100 bg-amber-50/70 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-900">
                  {disclaimer}
                </p>
              ) : null}
              <dl className="mt-4 space-y-1.5 text-xs text-slate-500">
                <div className="flex justify-between gap-3">
                  <dt>需要文件</dt>
                  <dd className="font-medium text-slate-700">
                    {required} 个必填
                    {optional > 0 ? ` / ${optional} 个可选` : ''}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>输出文件</dt>
                  <dd className="max-w-[60%] truncate text-right font-medium text-slate-700">
                    {sampleOutputFileName(workflow)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>敏感等级</dt>
                  <dd className="font-medium text-slate-700">{sensitivityLabel(level)}</dd>
                </div>
              </dl>
              {highRisk ? (
                <div
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
                  style={{ background: theme.chipBg, color: theme.chipText }}
                >
                  <AlertTriangle className="size-3.5" />
                  高风险 · 可能需人工确认
                </div>
              ) : (
                <div className="mt-4 text-[11px] text-slate-400">本地自动计算</div>
              )}
            </Link>
          );
        })}
      </div>

      <p className="pb-4 text-center text-xs text-slate-400">
        <Link to={theme.back} className={cn('hover:underline', theme.link)}>
          返回{theme.label.replace(/智能体$/, '')}工作台
        </Link>
        {' · '}
        <Link to={departmentHomePath(category)} className="hover:underline">
          刷新任务列表
        </Link>
      </p>
    </div>
  );
}
