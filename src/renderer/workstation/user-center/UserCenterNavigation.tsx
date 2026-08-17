import {
  CircleHelp,
  Coins,
  LayoutDashboard,
  Settings,
  WalletCards,
} from 'lucide-react';
import { cn } from '@workstation/lib/utils';
import type { UserCenterSection } from './userCenter.types';

/** Visible user-center nav entries (excludes undeveloped sections like usage). */
export const USER_CENTER_NAV_ITEMS: Array<{
  id: Exclude<UserCenterSection, 'usage'>;
  label: string;
  Icon: typeof LayoutDashboard;
}> = [
  { id: 'overview', label: '总览', Icon: LayoutDashboard },
  { id: 'credits', label: '积分明细', Icon: Coins },
  { id: 'recharge', label: '购买积分', Icon: WalletCards },
  { id: 'help', label: '帮助与反馈', Icon: CircleHelp },
  { id: 'settings', label: '设置', Icon: Settings },
];

type UserCenterNavigationProps = {
  active: UserCenterSection;
  onSelect: (section: UserCenterSection) => void;
};

export function UserCenterNavigation({ active, onSelect }: UserCenterNavigationProps) {
  return (
    <div>
      <div className="uc-nav-label">| 用户中心</div>
      <nav className="uc-nav" aria-label="用户中心导航">
        {USER_CENTER_NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={cn('uc-nav__item', active === id && 'uc-nav__item--active')}
            onClick={() => onSelect(id)}
          >
            <Icon className="size-4 opacity-80" strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
