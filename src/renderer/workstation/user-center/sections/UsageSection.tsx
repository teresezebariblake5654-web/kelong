import { useMemo, useState } from 'react';
import type { UsageRecord } from '../userCenter.types';

type UsageSectionProps = {
  records: UsageRecord[];
};

const DEPARTMENTS = [
  { code: '', label: '全部部门' },
  { code: 'hr', label: '人事' },
  { code: 'finance', label: '财务' },
  { code: 'ecommerce', label: '电商' },
  { code: 'administration', label: '行政综合' },
];

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function statusLabel(status: UsageRecord['status']) {
  switch (status) {
    case 'success':
      return '成功';
    case 'failed':
      return '失败';
    case 'pending':
      return '处理中';
    default:
      return status;
  }
}

export function UsageSection({ records }: UsageSectionProps) {
  const [department, setDepartment] = useState('');
  const [date, setDate] = useState('');

  const filtered = useMemo(() => {
    return records.filter((item) => {
      if (department && item.departmentCode !== department) return false;
      if (date && !item.createdAt.startsWith(date)) return false;
      return true;
    });
  }, [date, department, records]);

  return (
    <div className="uc-panel">
      <h3>消耗记录</h3>
      <p className="lead">按部门与日期筛选智能体调用消耗。</p>

      <div className="grid grid-cols-2 gap-2">
        <select
          className="uc-select"
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
        >
          {DEPARTMENTS.map((item) => (
            <option key={item.code || 'all'} value={item.code}>
              {item.label}
            </option>
          ))}
        </select>
        <input
          className="uc-input"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </div>

      <div className="uc-card !p-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-white/40">暂无匹配记录</p>
        ) : (
          filtered.map((item) => (
            <div key={item.id} className="uc-list-row">
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-medium">
                  {item.agentName} · {item.workMode}
                </div>
                <div className="uc-muted mt-0.5">
                  {formatTime(item.createdAt)} · {statusLabel(item.status)}
                </div>
              </div>
              <div className="shrink-0 text-[13px] font-semibold tabular-nums text-[#fca5a5]">
                -{item.credits}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
