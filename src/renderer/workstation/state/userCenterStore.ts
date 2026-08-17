import { create } from 'zustand';
import type { UserCenterSection } from '@workstation/user-center/userCenter.types';

type UserCenterStore = {
  open: boolean;
  section: UserCenterSection;
  openUserCenter: (section?: UserCenterSection) => void;
  closeUserCenter: () => void;
  toggleUserCenter: (section?: UserCenterSection) => void;
  setSection: (section: UserCenterSection) => void;
};

export const useUserCenterStore = create<UserCenterStore>((set, get) => ({
  open: false,
  section: 'overview',
  openUserCenter: (section = 'overview') => set({ open: true, section }),
  closeUserCenter: () => set({ open: false }),
  toggleUserCenter: (section) => {
    const { open } = get();
    if (open && (!section || section === get().section)) {
      set({ open: false });
      return;
    }
    set({ open: true, section: section ?? get().section });
  },
  setSection: (section) => set({ section, open: true }),
}));
