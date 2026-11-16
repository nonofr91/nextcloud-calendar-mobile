import { startLoginFlow, pollLoginFlow } from '../../src/services/nextcloud/loginFlow';
import { HttpError } from '../../src/services/shared/errors';
import { trustedFetch } from '../../src/services/shared/trustedFetch';

jest.mock('../../src/services/shared/trustedFetch', () => ({
  trustedFetch: jest.fn(),
}));

const mockFetch = trustedFetch as jest.MockedFunction<typeof trustedFetch>;

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Awaited<ReturnType<typeof trustedFetch>>;
}

beforeEach(() => jest.clearAllMocks());

describe('startLoginFlow', () => {
  it('POSTs to /index.php/login/v2 and returns session fields', async () => {
    mockFetch.mockResolvedValue(res(200, {
      poll: { token: 'tok123', endpoint: 'https://cloud.example.com/login/v2/poll' },
      login: 'https://cloud.example.com/login/v2/flow/abc',
    }));

    const session = await startLoginFlow('https://cloud.example.com');

    expect(mockFetch).toHaveBeenCalledWith('https://cloud.example.com/index.php/login/v2', { method: 'POST', body: '' });
    expect(session).toEqual({
      loginUrl: 'https://cloud.example.com/login/v2/flow/abc',
      pollEndpoint: 'https://cloud.example.com/login/v2/poll',
      pollToken: 'tok123',
    });
  });

  it('throws HttpError on a non-OK start response', async () => {
    mockFetch.mockResolvedValue(res(500, {}));
    await expect(startLoginFlow('https://cloud.example.com')).rejects.toBeInstanceOf(HttpError);
  });

  it('throws on a malformed response', async () => {
    mockFetch.mockResolvedValue(res(200, { poll: {} }));
    await expect(startLoginFlow('https://cloud.example.com')).rejects.toThrow('malformed');
  });
});

describe('pollLoginFlow', () => {
  const session = {
    loginUrl: 'https://cloud.example.com/login/v2/flow/abc',
    pollEndpoint: 'https://cloud.example.com/login/v2/poll',
    pollToken: 'tok123',
  };

  it('returns null while the login is pending (404)', async () => {
    mockFetch.mockResolvedValue(res(404, {}));
    await expect(pollLoginFlow(session)).resolves.toBeNull();
  });

  it('returns credentials once approved, with the trailing slash stripped', async () => {
    mockFetch.mockResolvedValue(res(200, {
      server: 'https://cloud.example.com/',
      loginName: 'john',
      appPassword: 'app-pw-123',
    }));

    await expect(pollLoginFlow(session)).resolves.toEqual({
      server: 'https://cloud.example.com',
      username: 'john',
      appPassword: 'app-pw-123',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      session.pollEndpoint,
      expect.objectContaining({ method: 'POST', body: 'token=tok123' }),
    );
  });

  it('throws HttpError on unexpected errors', async () => {
    mockFetch.mockResolvedValue(res(503, {}));
    await expect(pollLoginFlow(session)).rejects.toBeInstanceOf(HttpError);
  });
});
