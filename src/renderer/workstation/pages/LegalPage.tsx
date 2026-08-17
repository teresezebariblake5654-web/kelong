import { Link, useParams } from 'react-router-dom';
import { PageContainer } from '@workstation/components/layout/PageContainer';
import { Card, CardContent, CardHeader, CardTitle } from '@workstation/components/ui/card';
import { cn } from '@workstation/lib/utils';

type DocKey = 'terms' | 'privacy' | 'refund';

const DOCS: Record<
  DocKey,
  { title: string; paragraphs: string[] }
> = {
  terms: {
    title: '用户服务协议',
    paragraphs: [
      '本协议适用于「火星 AI / Agent Workstation」桌面客户端及相关云端服务。使用本产品即表示您同意本协议。',
      '您应合法取得待处理数据的使用权。原始业务表格默认在本地处理；仅在您主动发起云端分析时，才会上传结构化摘要（非完整原始文件，除非功能明确要求）。',
      '授权激活码与设备绑定受 License 条款约束。禁止破解、转售未授权激活码或绕过额度计费。',
      '我们可能因维护、安全或不可抗力暂停服务；造成的损失按可适用法律处理。',
      '完整商业合同条款以贵司与服务提供方签署的书面协议为准；本页为产品内公示摘要。',
    ],
  },
  privacy: {
    title: '隐私政策',
    paragraphs: [
      '我们收集的信息可能包括：账号与组织信息、设备绑定指纹、任务元数据、额度流水，以及您主动提交的分析摘要。',
      '本地 Excel/CSV 处理默认不上传原始文件。云端 AI 请求仅包含结构化摘要与必要上下文。',
      '数据用于提供服务、计费对账、安全审计与产品改进。未经授权不会出售个人数据。',
      '您可申请导出或删除账号相关数据（法律要求保留的计费/审计记录除外）。',
      '更多细节见仓库文档 docs/legal/PRIVACY.md；上线前请由法务审定并替换为正式版本。',
    ],
  },
  refund: {
    title: '退款与额度说明',
    paragraphs: [
      'AI 积分一经消耗（AI 分析成功扣费）一般不予退还；因系统故障导致的错误扣费可申请核查退回。',
      '未激活的授权码可在购买规则约定的期限内申请退款；已激活并绑定设备的 License 按书面销售合同执行。',
      '支付渠道（微信/支付宝）的退款时效与手续费以渠道规则为准。',
      '争议请联系客服并提供订单号、激活码（脱敏）与任务 ID。',
    ],
  },
};

export function LegalPage() {
  const { doc = 'terms' } = useParams();
  const key = (['terms', 'privacy', 'refund'].includes(doc) ? doc : 'terms') as DocKey;
  const current = DOCS[key];

  return (
    <PageContainer>
      <div className="mx-auto flex max-w-3xl flex-col gap-4 py-4">
        <nav className="flex flex-wrap gap-2 text-sm">
          {(Object.keys(DOCS) as DocKey[]).map((item) => (
            <Link
              key={item}
              to={`/legal/${item}`}
              className={cn(
                'rounded-full border px-3 py-1.5',
                item === key
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                  : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              {DOCS[item].title}
            </Link>
          ))}
        </nav>
        <Card>
          <CardHeader>
            <CardTitle>{current.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
            {current.paragraphs.map((p) => (
              <p key={p.slice(0, 24)}>{p}</p>
            ))}
            <p className="text-xs">
              正式法务文稿：仓库 <code className="rounded bg-muted px-1">docs/legal/</code>
            </p>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
