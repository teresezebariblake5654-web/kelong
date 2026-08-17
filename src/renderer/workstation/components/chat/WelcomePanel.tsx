import { FileSpreadsheet, ImageIcon, Lightbulb, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

type WelcomePanelProps = {
  onQuickPrompt: (text: string) => void;
};

const QUICK_ACTIONS = [
  {
    icon: Lightbulb,
    label: '选个话题',
    prompt: '帮我梳理今天最值得优先处理的业务问题',
  },
  {
    icon: FileSpreadsheet,
    label: '分析表格',
    prompt: '帮我总结这份表格的关键指标和异常点',
  },
  {
    icon: Search,
    label: '查找资料',
    prompt: '把这份文档整理成三条可执行要点',
  },
  {
    icon: ImageIcon,
    label: '识别图片',
    prompt: '识别图片中的文字并输出摘要',
  },
] as const;

export function WelcomePanel({ onQuickPrompt }: WelcomePanelProps) {
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-8 px-6 py-10 text-center">
      <h1 className="text-[32px] font-semibold tracking-tight text-foreground">今天有什么计划？</h1>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              onClick={() => onQuickPrompt(action.prompt)}
            >
              <Icon className="size-4" />
              {action.label}
            </button>
          );
        })}
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
          onClick={() => navigate('/templates')}
        >
          <FileSpreadsheet className="size-4" />
          工作智能体
        </button>
      </div>
    </div>
  );
}
