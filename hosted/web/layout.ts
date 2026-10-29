/**
 * The phone layout on any screen that is not a phone's width: a tablet, or a phone held wide. The UI picks its layout from media queries on
 * the layout viewport, so making that viewport phone-sized is enough. Does nothing with a mouse (a desktop window ignores the viewport tag).
 */
export function phoneLayout(width = 500) {
  if (!matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 768) return;
  document.querySelector('meta[name=viewport]')?.setAttribute('content', `width=${width}, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content`);
}
