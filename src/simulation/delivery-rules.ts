// 通知送达规则:分发成败与送达统计由规则 + 种子确定性计算(LLM 不参与,spec 决策 6/14)
// 每受众 × 尝试独立随机流;整条分发有小概率失败(可重试),失败只影响通知自身

import { mulberry32, randInt, jitter } from "./rng";

export type NotificationAudience = "staff_students" | "parents";

/** 通知受众显示词汇(与 GLOSSARY 同源:师生 / 家长) */
export const AUDIENCE_LABELS: Record<NotificationAudience, string> = {
  staff_students: "师生",
  parents: "家长",
};

export interface DeliveryStats {
  /** 通知对象总数 */
  total: number;
  /** 送达人数 */
  delivered: number;
  /** 未送达人数 */
  failed: number;
}

export interface DeliveryOutcome {
  /** 整条分发是否成功(失败则通知置 failed,可重试) */
  ok: boolean;
  stats: DeliveryStats;
}

/** 各受众的规模基准(±10% 抖动)与个体送达失败率上限 */
const AUDIENCE_PARAMS: Record<NotificationAudience, { totalBase: number; individualFailRate: number }> = {
  staff_students: { totalBase: 1_050, individualFailRate: 0.02 },
  parents: { totalBase: 780, individualFailRate: 0.02 },
};

/** 整条分发失败概率(通道故障,触发通知 failed 状态) */
const CHANNEL_FAIL_RATE = 0.15;

/** 通知最大发布尝试次数:首次 + 失败重试一次 */
export const MAX_PUBLISH_ATTEMPTS = 2;

function deliverySeed(seed: number, audience: NotificationAudience, attempt: number): number {
  const audienceHash = audience === "staff_students" ? 0x1f123bb5 : 0x2b7e1516;
  return (seed ^ 0x6c62272e ^ audienceHash ^ Math.imul(attempt, 0x9e3779b1)) >>> 0;
}

export function computeDelivery(
  seed: number,
  audience: NotificationAudience,
  attempt: number,
): DeliveryOutcome {
  const rng = mulberry32(deliverySeed(seed, audience, attempt));
  const params = AUDIENCE_PARAMS[audience];
  const total = jitter(rng, params.totalBase, 0.1);

  if (rng() < CHANNEL_FAIL_RATE) {
    // 通道故障:送达一部分后中断(送达比例由随机流决定)
    const delivered = randInt(rng, 0, Math.floor(total * 0.4));
    return { ok: false, stats: { total, delivered, failed: total - delivered } };
  }

  const failed = Math.floor(total * rng() * params.individualFailRate);
  return { ok: true, stats: { total, delivered: total - failed, failed } };
}
