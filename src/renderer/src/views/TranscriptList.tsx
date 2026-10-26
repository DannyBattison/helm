import React from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { TranscriptEvent } from '@shared/types';

const column: React.CSSProperties = { maxWidth: 820, margin: '0 auto', padding: '0 20px' };
const Header = ({ context }: any) => <div style={{ ...column, paddingTop: 20, paddingBottom: context.header ? 14 : 0 }}>{context.header}</div>;
const Footer = ({ context }: any) => <div style={{ ...column, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>{context.footer}</div>;

/**
 * A conversation as a virtual list: only the messages near the viewport exist in the DOM, however long the session is.
 * It starts at the bottom, follows new messages while you are at the bottom, and keeps your place when earlier
 * messages are loaded above (`firstIndex` is the index of `items[0]` in the whole conversation).
 */
export function TranscriptList({ items, firstIndex = 0, renderItem, header, footer, onStartReached, focusIndex }: {
  items: TranscriptEvent[];
  firstIndex?: number;
  renderItem(m: TranscriptEvent, index: number): React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  onStartReached?(): void;
  /** A message to scroll to and briefly highlight, e.g. the one a search result points at. */
  focusIndex?: number;
}) {
  const ref = React.useRef<VirtuosoHandle>(null);
  const [lit, setLit] = React.useState<number | undefined>(focusIndex);
  React.useEffect(() => {
    if (focusIndex == null || !items.length) { setLit(undefined); return; }
    setLit(focusIndex);
    ref.current?.scrollToIndex({ index: focusIndex, align: 'center' });
    const t = setTimeout(() => setLit(undefined), 2600);
    return () => clearTimeout(t);
  }, [focusIndex, items.length ? 1 : 0]);
  return (
    <Virtuoso
      ref={ref}
      // Remount once the first messages arrive so the list opens at the bottom.
      key={items.length ? 'ready' : 'empty'}
      style={{ height: '100%' }}
      data={items}
      firstItemIndex={firstIndex}
      initialTopMostItemIndex={focusIndex != null ? { index: focusIndex, align: 'center' } : { index: 'LAST', align: 'end' }}
      followOutput={(atBottom) => (atBottom ? 'auto' : false)}
      atBottomThreshold={160}
      increaseViewportBy={{ top: 600, bottom: 600 }}
      startReached={onStartReached}
      context={{ header, footer }}
      components={{ Header, Footer }}
      computeItemKey={(index) => index}
      itemContent={(index, m) => <div style={{ ...column, paddingBottom: 14 }}><div style={{ borderRadius: 'var(--radius-md)', transition: 'background var(--dur-slow)', background: index === lit ? 'var(--status-working-bg)' : 'transparent' }}>{renderItem(m, index)}</div></div>}
    />
  );
}
