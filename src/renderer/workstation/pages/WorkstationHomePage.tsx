import { useEffect } from 'react';
import { motion } from 'motion/react';
import { DepartmentScrollStack } from '@workstation/components/DepartmentScrollStack';
import { FadingVideo } from '@workstation/components/cinematic/FadingVideo';
import type { DepartmentAgent } from '@workstation/data/departmentAgents';
import heroVideoUrl from '@workstation/assets/cinematic/hero.mp4';
import brandMarkUrl from '@workstation/assets/brand/workhorse-mark.png';

type WorkstationHomePageProps = {
  onSelectDepartment: (department: DepartmentAgent) => void;
};

/**
 * Single composition home: one atmosphere, one focus (department card).
 * No second scroll page, no competing CTAs.
 */
export function WorkstationHomePage({ onSelectDepartment }: WorkstationHomePageProps) {
  useEffect(() => {
    document.documentElement.dataset.cinematicHome = '1';
    return () => {
      delete document.documentElement.dataset.cinematicHome;
    };
  }, []);

  return (
    <div className="cinematic-home-shell cinematic-home-shell--single cinematic-home-shell--unified">
      <section className="cinematic-section cinematic-section--solo relative flex w-full flex-col">
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
          <FadingVideo
            src={heroVideoUrl}
            className="absolute inset-0 cinematic-home-bg"
            objectPosition="center top"
            heroScale
          />
          <div className="cinematic-home-wash" />
        </div>

        <div className="relative z-10 flex min-h-[inherit] flex-1 flex-col items-center justify-center px-4 pb-8 pt-4 md:px-8">
          <motion.div
            className="mb-6 flex max-w-xl flex-col items-center text-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <img
              src={brandMarkUrl}
              alt="火星 AI"
              className="cinematic-brand-mark"
              draggable={false}
            />
            <h1 className="font-heading cinematic-hero-title tracking-tight">
              火星 AI
            </h1>
            <p className="cinematic-hero-subtitle mt-2 font-body text-[12px] font-light tracking-wide sm:text-sm">
              火星 AI · 选择部门 · 进入工作台
            </p>
          </motion.div>

          <motion.div
            className="w-full max-w-3xl"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <DepartmentScrollStack
              cinematic
              className="w-full"
              onSelect={onSelectDepartment}
            />
          </motion.div>
        </div>
      </section>
    </div>
  );
}
