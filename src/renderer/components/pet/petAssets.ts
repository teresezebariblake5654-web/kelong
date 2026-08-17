import { CoworkSessionStatusValue, type CoworkSessionStatus } from '../../types/cowork';

/**
 * Cow pet media pools. GIFs are large (~24MB total); only one <img> src is
 * active at a time so Electron loads clips on demand.
 *
 * Lines are bound to each clip at definition time so Vite content-hash filenames
 * cannot wipe bubble copy (previously fell back to「哞～再点一下？」).
 */
export type PetMood = 'idle' | 'thinking' | 'done' | 'error' | 'hungry' | 'dead' | 'reviving';

export type PetClip = {
  src: string;
  line: string;
};

const asset = (name: string): string =>
  new URL(`../../assets/pet/${name}`, import.meta.url).href;

function clip(name: string, line: string): PetClip {
  return { src: asset(name), line };
}

const IDLE: PetClip[] = [
  clip('idle-pinch.gif', '啥味儿？捂鼻遁走'),
  clip('idle-stand.gif', '我就这么站着看你'),
  clip('idle-look.gif', '嗯？叫我？'),
  // Keep idle lively: borrow a few motion clips (status still owns thinking/done/error).
  clip('thinking-bounce.gif', '蹦跶一下更聪明'),
  clip('done-happy.gif', '搞定啦，夸我！'),
  clip('done-surprise.png', '哞的天！'),
  clip('error-toast.webp', '生牛气（吐司版）'),
];

const THINKING: PetClip[] = [
  clip('thinking-walk.gif', '溜达溜达找灵感'),
  clip('thinking-bounce.gif', '蹦跶一下更聪明'),
  clip('thinking-spin.gif', '脑子转圈圈中'),
  clip('thinking-run.gif', '冲！任务别跑'),
  clip('thinking-kick.gif', '吃我一牛蹄！'),
  clip('thinking-hoof.webp', '蹄子预备——'),
];

const DONE: PetClip[] = [
  clip('done-happy.gif', '搞定啦，夸我！'),
  clip('done-cheer.gif', '牛牛胜利播报～'),
  clip('done-surprise.png', '哞的天！'),
  clip('done-still.webp', '圆满收工'),
];

const ERROR: PetClip[] = [
  clip('error-rage.gif', '生牛气！！'),
  clip('error-stomp.gif', '跺蹄警告一次'),
  clip('error-toast.webp', '生牛气（吐司版）'),
  clip('error-still.webp', '……不高兴'),
];

const EXTRA: PetClip[] = [
  clip('idle-still-a.webp', '发呆充电中…'),
  clip('idle-still-b.webp', '……（思考牛生）'),
];

/** Click-to-browse album: all distinct clips so tapping is not stuck in a tiny mood pool. */
export const PET_PLAYGROUND: PetClip[] = Array.from(
  new Map(
    [...IDLE, ...THINKING, ...DONE, ...ERROR, ...EXTRA].map((c) => [c.src, c] as const),
  ).values(),
);

/** How long click-browse stays before snapping back to status mood pool. */
export const PLAYGROUND_BROWSE_MS = 25_000;

export const PET_MOOD_POOLS: Record<PetMood, PetClip[]> = {
  idle: IDLE,
  thinking: THINKING,
  done: DONE,
  error: ERROR,
  hungry: [ERROR[2] ?? ERROR[0], IDLE[0], EXTRA[0]].filter(Boolean) as PetClip[],
  dead: [ERROR[3] ?? ERROR[0], ERROR[2]].filter(Boolean) as PetClip[],
  reviving: [DONE[2] ?? DONE[0], ERROR[0], THINKING[0]].filter(Boolean) as PetClip[],
};

export const PET_MOOD_BUBBLES: Record<PetMood, string> = {
  idle: '哞～',
  thinking: '干活中…',
  done: '哞的天！',
  error: '生牛气',
  hungry: '好饿…',
  dead: '葬送了…',
  reviving: '复活中…',
};

export const DONE_MOOD_MS = 8000;
export const THINKING_ROTATE_MS = 14_000;

/** @deprecated Prefer clip.line from the active pool entry. */
export function lineForClip(src: string | undefined | null): string {
  if (!src) return '哞～';
  const hit = PET_PLAYGROUND.find((c) => c.src === src);
  return hit?.line ?? '哞～';
}

export function resolvePetMood(input: {
  isStreaming: boolean;
  sessionStatus?: CoworkSessionStatus | null;
  /** Wall time until which we keep showing "done" after a completed run. */
  doneUntilMs?: number;
  nowMs?: number;
  /** Life layer overrides activity mood when dead / reviving / hungry. */
  lifeState?: 'alive' | 'hungry' | 'dead' | 'reviving';
  justRevivedUntil?: number;
}): PetMood {
  const now = input.nowMs ?? Date.now();
  if (input.lifeState === 'dead') return 'dead';
  if (input.lifeState === 'reviving') return 'reviving';
  if (input.justRevivedUntil != null && now < input.justRevivedUntil) return 'done';
  if (input.isStreaming || input.sessionStatus === CoworkSessionStatusValue.Running) {
    return 'thinking';
  }
  if (input.sessionStatus === CoworkSessionStatusValue.Error) {
    return 'error';
  }
  if (
    input.sessionStatus === CoworkSessionStatusValue.Completed
    && input.doneUntilMs != null
    && now < input.doneUntilMs
  ) {
    return 'done';
  }
  if (input.lifeState === 'hungry') return 'hungry';
  return 'idle';
}

export function poolForMood(mood: PetMood): PetClip[] {
  return PET_MOOD_POOLS[mood];
}
