import React from 'react';

import { SkinAssetSlot } from '../../../shared/skin/constants';
import { useSkinAsset } from '../../providers/SkinProvider';
import { SkinBackdropVariant } from '../skin/SkinBackdrop';
import './coworkLawnBackdrop.css';

interface CoworkLawnBackdropProps {
  variant: SkinBackdropVariant;
}

/**
 * Default pasture backdrop for the agent workspace when no skin image is applied.
 * Keeps the cow-pet theme without overriding a user-selected workspace skin.
 */
const CoworkLawnBackdrop: React.FC<CoworkLawnBackdropProps> = ({ variant }) => {
  const skinUrl = useSkinAsset(SkinAssetSlot.WorkspaceBackdrop);
  if (skinUrl) return null;

  const isHome = variant === SkinBackdropVariant.Home;

  return (
    <div
      aria-hidden="true"
      data-cowork-lawn={variant}
      className={`cowork-lawn pointer-events-none absolute inset-0 z-0 overflow-hidden${
        isHome ? ' cowork-lawn--home' : ' cowork-lawn--conversation'
      }`}
    >
      <div className="cowork-lawn__sky" />
      <div className="cowork-lawn__field" />
      <div className="cowork-lawn__blade" />
      <div className="cowork-lawn__haze" />
    </div>
  );
};

export default CoworkLawnBackdrop;
