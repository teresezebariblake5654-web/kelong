import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { isCowPetEnabled } from '../../../shared/featureFlags';
import CowPet from './CowPet';

const HOST_ID = 'lobster-cow-pet-layer';

function ensureHost(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById(HOST_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = HOST_ID;
    el.setAttribute('data-lobster-pet-host', '1');
    // Isolation shell: never capture clicks outside the pet frame
    el.style.cssText = [
      'position:fixed',
      'inset:0',
      'width:0',
      'height:0',
      'margin:0',
      'padding:0',
      'overflow:visible',
      'pointer-events:none',
      'z-index:25',
      'isolation:isolate',
    ].join(';');
    document.body.appendChild(el);
  }
  return el;
}

export interface CowPetHostProps {
  suspended?: boolean;
}

/**
 * Portal host for the decorative cow pet.
 * Mounted outside the main React tree layout so stacking/pointer events
 * do not fight Sidebar / Composer / Settings.
 */
const CowPetHost: React.FC<CowPetHostProps> = ({ suspended = false }) => {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!isCowPetEnabled()) return;
    setHost(ensureHost());
    return () => {
      // Keep host node; CowPet unmounts. Avoid removing if other mounts exist.
    };
  }, []);

  if (!isCowPetEnabled() || !host) return null;

  return createPortal(
    <CowPet suspended={suspended} />,
    host,
  );
};

export default CowPetHost;
