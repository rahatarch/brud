import { useState, useCallback, useEffect, forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react';

interface CustomScrollbarProps {
  children: ReactNode;
  className?: string;
}

const CustomScrollbar = forwardRef<HTMLDivElement, CustomScrollbarProps>(
  function CustomScrollbar({ children, className = '' }, ref) {
    const contentRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [scrollHeight, setScrollHeight] = useState(0);
    const [clientHeight, setClientHeight] = useState(0);
    const [isDragging, setIsDragging] = useState(false);

    useImperativeHandle(ref, () => contentRef.current!, []);

    const updateScrollInfo = useCallback(() => {
      const el = contentRef.current;
      if (el) {
        setScrollTop(el.scrollTop);
        setScrollHeight(el.scrollHeight);
        setClientHeight(el.clientHeight);
      }
    }, []);

    useEffect(() => {
      const el = contentRef.current;
      const wrapper = wrapperRef.current;
      if (!el) return;
      updateScrollInfo();
      const observer = new ResizeObserver(updateScrollInfo);
      observer.observe(el);
      if (wrapper) observer.observe(wrapper);
      return () => observer.disconnect();
    }, [updateScrollInfo]);

    const handleScroll = useCallback(() => {
      updateScrollInfo();
    }, [updateScrollInfo]);

    const thumbHeight = clientHeight > 0
      ? Math.max(20, (clientHeight / scrollHeight) * clientHeight)
      : 0;

    const thumbTop = scrollHeight > clientHeight
      ? (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - thumbHeight)
      : 0;

    const showThumb = scrollHeight > clientHeight;

    const handleTrackClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      const el = contentRef.current;
      if (!el) return;
      const trackRect = e.currentTarget.getBoundingClientRect();
      const clickY = e.clientY - trackRect.top;
      const ratio = clickY / clientHeight;
      el.scrollTop = ratio * (scrollHeight - clientHeight);
    }, [clientHeight, scrollHeight]);

    const handleThumbMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      const startY = e.clientY;
      const startScrollTop = contentRef.current?.scrollTop || 0;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const el = contentRef.current;
        if (!el) return;
        const deltaY = moveEvent.clientY - startY;
        const ratio = deltaY / clientHeight;
        el.scrollTop = startScrollTop + ratio * (scrollHeight - clientHeight);
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }, [clientHeight, scrollHeight]);

    return (
      <div ref={wrapperRef} data-custom-scrollbar className={`relative overflow-hidden ${className}`}>
        <div
          ref={contentRef}
          data-scroll-inner
          className="h-full overflow-y-scroll"
          onScroll={handleScroll}
        >
          {children}
        </div>
        {showThumb && (
          <div
            className="absolute right-0 top-0 h-full w-[8px] cursor-pointer bg-[var(--color-surface-2)]"
            onMouseDown={handleTrackClick}
          >
            <div
              className={`absolute left-[2px] w-[4px] rounded-[2px] transition-colors ${
                isDragging ? 'bg-[var(--color-text-secondary)]' : 'bg-[var(--color-text-muted)]'
              } hover:bg-[var(--color-text-secondary)]`}
              style={{
                height: thumbHeight,
                top: thumbTop,
              }}
              onMouseDown={handleThumbMouseDown}
            />
          </div>
        )}
      </div>
    );
  }
);

export default CustomScrollbar;