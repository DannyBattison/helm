const PERIOD = 1600;

/** The helm-pulse animation, phase-locked to the clock so every pulsing dot blinks together however late it appeared. */
export const pulseAnimation = () => `helm-pulse ${PERIOD}ms var(--ease-in-out) ${-(Date.now() % PERIOD)}ms infinite`;
