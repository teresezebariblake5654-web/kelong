/**
 * Feature flags for controlling experimental or incomplete features.
 * Toggle these to enable/disable features globally.
 */

/** Whether to enable OpenClaw skill sync (auto-detect + manual sync entry) */
export const ENABLE_OPENCLAW_SKILL_SYNC = false;

/**
 * Youdao cloud / portal / Overmind / branding surfaces.
 * When false: hide login/billing/server models/ASR/media/HTML share/stores/updates
 * and strip Youdao branding. Local agent + BYO LLM keep working.
 */
export const YOUDAO_CLOUD_ENABLED = false;

export const isYoudaoCloudEnabled = (): boolean => YOUDAO_CLOUD_ENABLED;

/**
 * IM bots (WeChat / Feishu / DingTalk / Telegram / …).
 * When false: hide Settings + Agent IM UI and strip OpenClaw IM channels.
 */
export const IM_BOT_ENABLED = true;

export const isImBotEnabled = (): boolean => IM_BOT_ENABLED;

/**
 * Built-in cow pet overlay (decorative vitality widget).
 * Isolated from core agent/workstation flows; disable to remove entirely.
 */
export const COW_PET_ENABLED = true;

export const isCowPetEnabled = (): boolean => COW_PET_ENABLED;

/**
 * Demo / pitch mode: cow stays (or snaps back to) fully alive.
 * When true: skip starve decay and auto-revive on load if dead.
 * Flip to false before a “饥饿→复活”玩法正式对外验收。
 */
export const COW_PET_DEMO_ALWAYS_ALIVE = true;

export const isCowPetDemoAlwaysAlive = (): boolean => COW_PET_DEMO_ALWAYS_ALIVE;
