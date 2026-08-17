import type { CreditOverview, UserCenterSection } from './userCenter.types';
import { CreditsSection } from './sections/CreditsSection';
import { HelpFeedbackSection } from './sections/HelpFeedbackSection';
import { OverviewSection } from './sections/OverviewSection';
import { RechargeSection } from './sections/RechargeSection';
import { SettingsSection } from './sections/SettingsSection';

type UserCenterContentProps = {
  section: UserCenterSection;
  onSection: (section: UserCenterSection) => void;
  onSummaryLoaded?: (overview: CreditOverview) => void;
  onAuthChange?: () => void;
};

export function UserCenterContent({
  section,
  onSection,
  onSummaryLoaded,
  onAuthChange,
}: UserCenterContentProps) {
  switch (section) {
    case 'overview':
      return (
        <OverviewSection
          onGoRecharge={() => onSection('recharge')}
          onGoCredits={() => onSection('credits')}
          onGoLogin={() => onSection('settings')}
          onSummaryLoaded={onSummaryLoaded}
        />
      );
    case 'recharge':
      return (
        <RechargeSection
          onSummaryLoaded={onSummaryLoaded}
          onGoLogin={() => onSection('settings')}
        />
      );
    case 'credits':
      return (
        <CreditsSection
          onSummaryLoaded={onSummaryLoaded}
          onGoLogin={() => onSection('settings')}
        />
      );
    case 'help':
      return <HelpFeedbackSection />;
    case 'settings':
      return <SettingsSection onAuthChange={onAuthChange} />;
    case 'usage':
      // Usage API not wired yet — nav entry is hidden; fall back to overview.
      return (
        <OverviewSection
          onGoRecharge={() => onSection('recharge')}
          onGoCredits={() => onSection('credits')}
          onGoLogin={() => onSection('settings')}
          onSummaryLoaded={onSummaryLoaded}
        />
      );
    default:
      return null;
  }
}
