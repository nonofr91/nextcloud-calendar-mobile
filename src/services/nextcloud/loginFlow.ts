import { httpErrorFrom } from '../shared/errors';
import { trustedFetch } from '../shared/trustedFetch';

/**
 * Nextcloud Login Flow v2 — the device *displays* a QR/login URL and polls
 * until the user approves it on another device. This is the flow that lets
 * an AAOS install (or any keyboard-poor device) sign in without typing a
 * password: the car shows the QR, the phone approves, the car polls and
 * receives a freshly minted app password.
 *
 * https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html#login-flow-v2
 */
export interface LoginFlowSession {
  /** URL the user must open/scan on an authenticated device to approve. */
  loginUrl: string;
  pollEndpoint: string;
  pollToken: string;
}

export interface LoginFlowCredentials {
  /** Canonical server URL returned by the server (after any redirects). */
  server: string;
  username: string;
  appPassword: string;
}

export async function startLoginFlow(baseUrl: string): Promise<LoginFlowSession> {
  const res = await trustedFetch(`${baseUrl}/index.php/login/v2`, {
    method: 'POST',
    // The native fetch layer rejects POSTs without a body.
    body: '',
  });
  if (!res.ok) throw httpErrorFrom(res, 'startLoginFlow');

  const json = await res.json();
  const loginUrl = json?.login;
  const pollEndpoint = json?.poll?.endpoint;
  const pollToken = json?.poll?.token;
  if (
    typeof loginUrl !== 'string' || !loginUrl ||
    typeof pollEndpoint !== 'string' || !pollEndpoint ||
    typeof pollToken !== 'string' || !pollToken
  ) {
    throw new Error('startLoginFlow: malformed response');
  }
  return { loginUrl, pollEndpoint, pollToken };
}

/**
 * One poll attempt. Returns `null` while the login is still pending approval
 * (server answers 404 until the user completes the flow — not an error).
 */
export async function pollLoginFlow(session: LoginFlowSession): Promise<LoginFlowCredentials | null> {
  const res = await trustedFetch(session.pollEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `token=${encodeURIComponent(session.pollToken)}`,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw httpErrorFrom(res, 'pollLoginFlow');

  const json = await res.json();
  const server = json?.server;
  const username = json?.loginName;
  const appPassword = json?.appPassword;
  if (
    typeof server !== 'string' || !server ||
    typeof username !== 'string' || !username ||
    typeof appPassword !== 'string' || !appPassword
  ) {
    throw new Error('pollLoginFlow: malformed response');
  }
  return { server: server.replace(/\/$/, ''), username, appPassword };
}
