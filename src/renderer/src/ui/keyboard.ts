import type React from 'react';
/** Keyboard activation for compound rows that also contain independent controls. */
export const keyboardClick = {
  role: 'button',
  tabIndex: 0,
  onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.click();
  },
};
