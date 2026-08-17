import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { resolveAvatarDisplayUrl } from '@workstation/lib/avatarUrl';
import { authSessionService } from '@workstation/services/authSession.service';
import type { UserCenterProfile } from './userCenter.types';

type UserProfileCardProps = {
  profile: UserCenterProfile;
  onAvatarChanged?: () => void;
};

export function UserProfileCard({ profile, onAvatarChanged }: UserProfileCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avatarSrc = resolveAvatarDisplayUrl(profile.avatarUrl);

  const onPick = async (file: File | undefined) => {
    if (!file || !profile.loggedIn) return;
    setUploading(true);
    setError(null);
    try {
      await authSessionService.uploadAvatar(file);
      onAvatarChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败，请重试');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="uc-card flex items-center gap-3">
      <div className="relative shrink-0">
        <button
          type="button"
          disabled={!profile.loggedIn || uploading}
          className="flex size-12 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-white/10 text-sm font-semibold disabled:opacity-60"
          title={profile.loggedIn ? '更换头像' : '登录后可上传头像'}
          onClick={() => inputRef.current?.click()}
        >
          {avatarSrc ? (
            <img src={avatarSrc} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center bg-indigo-500 text-indigo-50">
              <svg viewBox="0 0 64 64" className="size-8" aria-hidden>
                <circle cx="32" cy="24" r="12" fill="currentColor" opacity="0.95" />
                <path d="M12 54c0-11 9-20 20-20s20 9 20 20" fill="currentColor" opacity="0.95" />
              </svg>
            </span>
          )}
        </button>
        {profile.loggedIn ? (
          <span
            className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full border border-white/20 bg-[#1a1d28] text-[#ecd9a8]"
            aria-hidden
          >
            <Camera className="size-3" />
          </span>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={(event) => void onPick(event.target.files?.[0])}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[14px] font-semibold tracking-tight">
            {profile.displayName}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-white/55">
            <span
              className="size-1.5 rounded-full"
              style={{ background: profile.loggedIn ? '#34d399' : '#94a3b8' }}
            />
            {profile.loggedIn ? (uploading ? '上传中…' : '已登录') : '未登录'}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-white/45">{profile.organizationName}</p>
        {error ? (
          <p className="mt-1 text-[11px] text-rose-300">{error}</p>
        ) : profile.loggedIn ? (
          <p className="mt-1 text-[11px] text-white/35">点击头像更换（png / jpg / webp，≤5MB）</p>
        ) : null}
        <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-[#d4b978]/35 bg-[#d4b978]/15 px-2 py-0.5 text-[10px] font-medium text-[#ecd9a8]">
          <span aria-hidden>♛</span>
          {profile.roleLabel}
        </span>
      </div>
    </div>
  );
}
