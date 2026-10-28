import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { readGameViewport } from '../core/viewport';
import './landscape-viewport.css';
import { FullscreenButton } from './FullscreenButton';

/** A single horizontal coordinate space for menus, game, and overlays. */
export function LandscapeViewport({ children }: { children: ReactNode }) {
  const [viewport, setViewport] = useState(readGameViewport);
  useEffect(() => {
    const resize = () => setViewport(readGameViewport());
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
    };
  }, []);
  const style = {
    width: viewport.width,
    height: viewport.height,
    top: viewport.offsetTop,
    left: viewport.offsetLeft + (viewport.rotated ? viewport.screenWidth : 0),
    transform: viewport.rotated ? 'rotate(90deg)' : 'rotate(0deg)',
    '--viewport-safe-left': `env(safe-area-inset-${viewport.rotated ? 'top' : 'left'})`,
    '--viewport-safe-right': `env(safe-area-inset-${viewport.rotated ? 'bottom' : 'right'})`,
    '--viewport-safe-top': `env(safe-area-inset-${viewport.rotated ? 'right' : 'top'})`,
    '--viewport-safe-bottom': `env(safe-area-inset-${viewport.rotated ? 'left' : 'bottom'})`,
  } as CSSProperties;
  return <div className="landscape-viewport" data-rotated={viewport.rotated} style={style}>
    <div className="landscape-scroll">{children}</div>
    <FullscreenButton />
  </div>;
}
