import { useCallback, useEffect, useReducer, useRef } from 'react';

const LIMIT = 100;
const SETTLE_MS = 400;

/**
 * Undo/redo over serialized editor snapshots. Changes are recorded once they
 * settle for SETTLE_MS, so typing a label or dragging a node is one step.
 *
 * `sig` is the current snapshot; `apply` restores one.
 */
export function useHistory(sig: string, apply: (snapshot: string) => void) {
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const committed = useRef<string | null>(null);
  // Set while a restore (undo/redo/load) is being rendered: that change isn't a new step.
  const restoring = useRef(false);
  // Set by checkpoint(): the next change is a discrete action, recorded right away.
  const immediate = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  const commit = useCallback((current: string) => {
    clearTimeout(timer.current);
    if (committed.current === null || current === committed.current) {
      committed.current = current;
      return;
    }
    past.current.push(committed.current);
    if (past.current.length > LIMIT) past.current.shift();
    future.current = [];
    committed.current = current;
    rerender();
  }, []);

  useEffect(() => {
    if (restoring.current) {
      // The restored state may serialise slightly differently from the snapshot.
      restoring.current = false;
      if (committed.current !== sig) {
        committed.current = sig;
        rerender();
      }
      return;
    }
    clearTimeout(timer.current);
    if (immediate.current) {
      immediate.current = false;
      commit(sig);
      return;
    }
    timer.current = setTimeout(() => commit(sig), SETTLE_MS);
  }, [sig, commit]);

  useEffect(() => () => clearTimeout(timer.current), []);

  /** Forget history, e.g. after opening another workflow. */
  const reset = useCallback(
    (next: string) => {
      clearTimeout(timer.current);
      past.current = [];
      future.current = [];
      committed.current = next;
      restoring.current = next !== sig;
      rerender();
    },
    [sig],
  );

  const step = useCallback(
    (from: React.MutableRefObject<string[]>, to: React.MutableRefObject<string[]>) => {
      commit(sig); // flush a change that hasn't settled yet
      const target = from.current.pop();
      if (target === undefined || committed.current === null) return;
      to.current.push(committed.current);
      committed.current = target;
      restoring.current = true;
      apply(target);
      rerender();
    },
    [apply, commit, sig],
  );

  /** Call before a discrete edit (add, delete, connect): it becomes its own step. */
  const checkpoint = useCallback(() => {
    commit(sig);
    immediate.current = true;
  }, [commit, sig]);

  return {
    checkpoint,
    undo: useCallback(() => step(past, future), [step]),
    redo: useCallback(() => step(future, past), [step]),
    reset,
    canUndo: past.current.length > 0 || (committed.current !== null && sig !== committed.current),
    canRedo: future.current.length > 0 && sig === committed.current,
  };
}
