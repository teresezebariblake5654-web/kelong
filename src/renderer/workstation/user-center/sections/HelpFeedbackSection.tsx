import { FormEvent, useState } from 'react';
import { MOCK_FAQ } from '../userCenter.mock';
import { submitFeedback } from '../userCenterApi';

const CATEGORIES = ['功能建议', '问题反馈', '充值相关', '其他'] as const;

export function HelpFeedbackSection() {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('功能建议');
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [emailConsent, setEmailConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setHint('');
    if (!emailConsent) {
      setError('请勾选同意提交反馈');
      return;
    }
    const trimmed = content.trim();
    if (trimmed.length < 4) {
      setError('请至少填写 4 个字的反馈内容');
      return;
    }

    setLoading(true);
    try {
      const result = await submitFeedback({
        category,
        content: trimmed,
        contact: contact.trim() || undefined,
        emailConsent: true,
      });
      setHint(
        result.delivered
          ? '反馈已提交，我们会尽快处理。'
          : '反馈已记录。邮件通知暂不可用，我们仍会在后台查看。',
      );
      setContent('');
      setEmailConsent(false);
    } catch (err) {
      const raw = err instanceof Error ? err.message : '提交失败，请稍后重试';
      setError(
        /内部错误|INTERNAL_ERROR|500/i.test(raw)
          ? '反馈暂不可用，请稍后重试或联系客服'
          : raw,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="uc-panel">
      <h3>帮助与反馈</h3>
      <p className="lead">常见问题，或直接在此提交反馈。</p>

      <div className="uc-card space-y-2">
        <div className="text-[11px] font-medium text-white/45">常见问题</div>
        {MOCK_FAQ.map((item) => (
          <div key={item.q}>
            <div className="text-[12.5px] font-medium">{item.q}</div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-white/45">{item.a}</p>
          </div>
        ))}
      </div>

      <form className="uc-card space-y-3" onSubmit={(e) => void onSubmit(e)}>
        <div className="text-[12px] font-medium">在线反馈</div>
        <p className="uc-muted leading-relaxed">填写后一键提交，无需离开应用。</p>

        <label className="block space-y-1 text-[12px]">
          <span className="text-white/55">分类</span>
          <select
            className="uc-select w-full"
            value={category}
            onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
          >
            {CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1 text-[12px]">
          <span className="text-white/55">反馈内容</span>
          <textarea
            className="uc-textarea w-full"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="请描述你的问题或建议"
            maxLength={4000}
            required
          />
        </label>

        <label className="block space-y-1 text-[12px]">
          <span className="text-white/55">联系方式（选填）</span>
          <input
            className="uc-input w-full"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="邮箱 / 手机号，方便回复"
            maxLength={200}
          />
        </label>

        <label className="flex items-start gap-2 text-[12px] text-white/70">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={emailConsent}
            onChange={(e) => setEmailConsent(e.target.checked)}
          />
          <span>我同意将本次反馈提交给客服处理</span>
        </label>

        {error ? <p className="text-[12px] text-rose-300">{error}</p> : null}
        {hint ? <p className="text-[12px] text-emerald-300/90">{hint}</p> : null}

        <button type="submit" className="uc-btn-gold" disabled={loading}>
          {loading ? '提交中…' : '提交反馈'}
        </button>
      </form>
    </div>
  );
}
