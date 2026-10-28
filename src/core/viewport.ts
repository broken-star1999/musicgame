export function gameViewport(screenWidth: number, screenHeight: number, offsetLeft = 0, offsetTop = 0) {
  const rotated = screenHeight > screenWidth;
  return {
    width: rotated ? screenHeight : screenWidth,
    height: rotated ? screenWidth : screenHeight,
    screenWidth,
    screenHeight,
    rotated,
    offsetLeft,
    offsetTop,
  };
}

export function readGameViewport() {
  const viewport = window.visualViewport;
  return gameViewport(viewport?.width || window.innerWidth, viewport?.height || window.innerHeight, viewport?.offsetLeft || 0, viewport?.offsetTop || 0);
}

/** Invert the screen's clockwise rotation, including canvas offsets and scaling. */
export function canvasPoint(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  logicalWidth: number,
  logicalHeight: number,
  rotated: boolean,
) {
  if (rect.width <= 0 || rect.height <= 0) return { x: -Infinity, y: -Infinity };
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  return rotated ? { x: y * logicalWidth, y: (1 - x) * logicalHeight } : { x: x * logicalWidth, y: y * logicalHeight };
}
