import { useNavigate } from 'react-router-dom';
import { DepartmentCard } from '@workstation/components/departments/DepartmentCard';
import { PageContainer } from '@workstation/components/layout/PageContainer';
import { PUBLISHED_DEPARTMENT_AGENTS } from '@workstation/data/departmentAgents';
import '@workstation/components/departments/departmentIcons.css';

/** 工作智能体：仅上架主推岗位（与 PUBLISHED_AGENT_CODES 一致） */
export function DepartmentGridPage() {
  const navigate = useNavigate();

  return (
    <PageContainer width="full" className="h-full">
      <div className="mx-auto flex h-full max-w-5xl flex-col gap-6 py-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">工作智能体</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            选择岗位智能体进入工作台。工作模式、指标与快捷任务由统一模板按配置切换。
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4 max-[1100px]:grid-cols-2 max-[720px]:grid-cols-1">
          {PUBLISHED_DEPARTMENT_AGENTS.map((department) => (
            <DepartmentCard
              key={department.code}
              department={department}
              onClick={() => navigate(`/templates/${department.code}`)}
            />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
