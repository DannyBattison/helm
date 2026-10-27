import React from 'react';

const PERIOD = 1600;

/** The helm-pulse animation, phase-locked to the clock so every pulsing dot blinks together however late it appeared. */
const pulseAnimation = () => `helm-pulse ${PERIOD}ms var(--ease-in-out) ${-(Date.now() % PERIOD)}ms infinite`;

/** The pulse for one element. Fixed while `on` stays true: a new value on every render would restart the animation and make it flicker. */
export function usePulse(on = true): string | undefined {
  return React.useMemo(() => (on ? pulseAnimation() : undefined), [on]);
}
