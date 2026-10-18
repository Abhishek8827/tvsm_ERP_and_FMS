import { useEffect, useRef } from 'react';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];

/**
 * Calls `onIdle` once after `timeoutMs` without any mouse, keyboard or touch activity.
 * WHY: the cashier PC may be shared (decision: 10 minutes). It compares timestamps every 5 seconds
 * instead of trusting one long timer, so it still fires correctly after the laptop sleeps.
 */
export function useIdleTimeout(enabled, timeoutMs, onIdle) {
  const last = useRef(0);
  const callback = useRef(onIdle);
  useEffect(() => {
    callback.current = onIdle;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    last.current = Date.now();
    const touch = () => {
      last.current = Date.now();
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, touch, { passive: true });
    const timer = window.setInterval(() => {
      if (Date.now() - last.current >= timeoutMs) {
        window.clearInterval(timer);
        callback.current();
      }
    }, 5000);
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, touch);
      window.clearInterval(timer);
    };
  }, [enabled, timeoutMs]);
}
