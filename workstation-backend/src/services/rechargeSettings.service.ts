import { env } from '../config/env';

export type RechargeSettingsPublic = {
  wechatQrUrl: string | null;
  alipayQrUrl: string | null;
  /** Fixed-amount WeChat QR by yuan string key: "50" | "100" | "500". */
  wechatQrByAmount: Record<string, string>;
  /** Fixed-amount Alipay QR by yuan string key: "50" | "100" | "500". */
  alipayQrByAmount: Record<string, string>;
  payeeName: string | null;
  supportText: string | null;
  notice: string | null;
};

function nullableUrl(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildQrByAmount(
  fifty: string,
  hundred: string,
  fiveHundred: string,
): Record<string, string> {
  const map: Record<string, string> = {};
  const a = nullableUrl(fifty);
  const b = nullableUrl(hundred);
  const c = nullableUrl(fiveHundred);
  if (a) map['50'] = a;
  if (b) map['100'] = b;
  if (c) map['500'] = c;
  return map;
}

/** Phase 7: read-only payment display settings from env (no DB / no billing mutation). */
export function getRechargeSettings(): RechargeSettingsPublic {
  const wechatQrByAmount = buildQrByAmount(
    env.paymentWechatQrUrl50,
    env.paymentWechatQrUrl100,
    env.paymentWechatQrUrl500,
  );
  const alipayQrByAmount = buildQrByAmount(
    env.paymentAlipayQrUrl50,
    env.paymentAlipayQrUrl100,
    env.paymentAlipayQrUrl500,
  );
  return {
    wechatQrUrl:
      nullableUrl(env.paymentWechatQrUrl) ??
      wechatQrByAmount['50'] ??
      Object.values(wechatQrByAmount)[0] ??
      null,
    alipayQrUrl:
      nullableUrl(env.paymentAlipayQrUrl) ??
      alipayQrByAmount['50'] ??
      Object.values(alipayQrByAmount)[0] ??
      null,
    wechatQrByAmount,
    alipayQrByAmount,
    payeeName: nullableText(env.paymentPayeeName),
    supportText: nullableText(env.paymentSupportText),
    notice: nullableText(env.paymentNotice),
  };
}
