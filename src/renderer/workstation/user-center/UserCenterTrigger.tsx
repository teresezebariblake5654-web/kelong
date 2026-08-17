import { cn } from '@workstation/lib/utils';
import { useUserCenterStore } from '@workstation/state/userCenterStore';
import type { UserCenterSection } from './userCenter.types';

/** Soft default avatar so the trigger always reads as a profile photo, never a random「用」. */
const DEFAULT_AVATAR_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
    <rect width="64" height="64" rx="32" fill="#6366F1"/>
    <circle cx="32" cy="24" r="12" fill="#EEF2FF"/>
    <path d="M12 54c0-11 9-20 20-20s20 9 20 20" fill="#EEF2FF"/>
  </svg>`,
);

const DEFAULT_AVATAR_SRC = `data:image/svg+xml,${DEFAULT_AVATAR_SVG}`;

type UserCenterTriggerProps = {
  /** @deprecated Initials are no longer shown; use avatarUrl. */
  initials?: string;
  avatarUrl?: string | null;
  className?: string;
  /** When set, open that section; otherwise toggle with current/overview */
  section?: UserCenterSection;
  title?: string;
  /** Apple-style black frosted glass (cinematic home). */
  variant?: 'default' | 'frost';
};

export function UserCenterTrigger({
  avatarUrl,
  className,
  section,
  title = '打开用户中心',
  variant = 'default',
}: UserCenterTriggerProps) {
  const toggleUserCenter = useUserCenterStore((s) => s.toggleUserCenter);
  const src = avatarUrl?.trim() || DEFAULT_AVATAR_SRC;

  return (
    <button
      type="button"
      className={cn(
        'uc-trigger uc-trigger--avatar',
        variant === 'frost' && 'uc-trigger--frost',
        className,
      )}
      title={title}
      aria-label={title}
      onClick={() => toggleUserCenter(section)}
    >
      <img src={src} alt="" className="uc-trigger__avatar" draggable={false} />
    </button>
  );
}
