type IdleCb = (cb: () => void, opts?: { timeout: number }) => void;

export function yieldToUI(maxWaitMs = 250): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const ric = (globalThis as { requestIdleCallback?: IdleCb }).requestIdleCallback;
    if (typeof ric === 'function') {
      ric(finish, { timeout: maxWaitMs });
    } else {
      setTimeout(finish, 0);
    }
    setTimeout(finish, maxWaitMs);
  });
}
