import { useNavigate } from 'react-router-dom';
import { PageBackButton } from '@workstation/components/layout/PageBackButton';
import { MaterialCloseStartPage } from '@workstation/pages/materialClose/MaterialCloseStartPage';
import { MaterialExceptionPage } from '@workstation/pages/materialClose/MaterialExceptionPage';
import { MaterialCloseResultPage } from '@workstation/pages/materialClose/MaterialCloseResultPage';
import { useMaterialCloseSessionStore } from '@workstation/state/materialCloseSessionStore';

/**
 * 生产物料日清三页主流程：开始 → 异常确认 → 结果下载。
 * 隐藏旧九步分析向导（本入口不进入 Sheet/映射/清洗/模型选择）。
 */
export function MaterialDailyClosePage() {
  const navigate = useNavigate();
  const step = useMaterialCloseSessionStore((s) => s.step);

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-5xl px-4 pt-4">
        <PageBackButton
          onBack={() => navigate('/templates/production')}
          label="返回工作站"
        />
        <div className="mt-2 flex gap-2 text-xs text-muted-foreground">
          <StepDot active={step === 'start'} label="上传" />
          <StepDot active={step === 'exception'} label="确认" />
          <StepDot active={step === 'result'} label="下载" />
        </div>
      </div>
      {step === 'start' ? <MaterialCloseStartPage /> : null}
      {step === 'exception' ? <MaterialExceptionPage /> : null}
      {step === 'result' ? <MaterialCloseResultPage /> : null}
    </div>
  );
}

function StepDot({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={active ? 'font-medium text-foreground' : undefined}>
      {label}
      {active ? ' ·' : ''}
    </span>
  );
}
