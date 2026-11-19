import { useLayoutEffect, useRef } from 'react';

/**
 * A ref that always holds the latest `value`. Lets a memoized row or map marker take one stable
 * callback that calls whatever the store's action is now, instead of re-rendering for a new one.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
