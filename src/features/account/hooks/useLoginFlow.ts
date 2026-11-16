import { useCallback, useEffect, useRef, useState } from 'react';
import {
  pollLoginFlow,
  type LoginFlowSession,
  type LoginFlowCredentials,
} from '@/services/nextcloud/loginFlow';

const POLL_INTERVAL_MS = 2000;
/** Nextcloud keeps a v2 session open ~20 min; stop polling past that. */
const SESSION_TIMEOUT_MS = 20 * 60 * 1000;

export type LoginFlowStatus = 'idle' | 'starting' | 'pending' | 'expired' | 'error';

export function useLoginFlow(onCredentials: (creds: LoginFlowCredentials) => void) {
  const [session, setSession] = useState<LoginFlowSession | null>(null);
  const [status, setStatus] = useState<LoginFlowStatus>('idle');
  const onCredentialsRef = useRef(onCredentials);
  onCredentialsRef.current = onCredentials;

  const cancel = useCallback(() => {
    setSession(null);
    setStatus('idle');
  }, []);

  // The thunk lets the caller wrap startLoginFlow in the cert-trust and
  // cleartext-consent gates; it resolves undefined while a consent sheet
  // takes over (the caller retries once consent is granted).
  const start = useCallback(async (startFlow: () => Promise<LoginFlowSession | undefined>) => {
    setStatus('starting');
    setSession(null);
    try {
      const session = await startFlow();
      if (session === undefined) {
        setStatus('idle');
        return;
      }
      setSession(session);
      setStatus('pending');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!session || status !== 'pending') return;
    let cancelled = false;
    const deadline = Date.now() + SESSION_TIMEOUT_MS;

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() > deadline) {
        setStatus('expired');
        setSession(null);
        return;
      }
      try {
        const creds = await pollLoginFlow(session);
        if (cancelled) return;
        if (creds) {
          setSession(null);
          setStatus('idle');
          onCredentialsRef.current(creds);
        }
      } catch {
        if (!cancelled) {
          setStatus('error');
          setSession(null);
        }
      }
    };

    const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [session, status]);

  return { session, status, start, cancel };
}
