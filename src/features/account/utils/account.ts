import type { Account } from '@/types';

export interface AccountProfilePatch {
  displayName?: string;
  email?: string;
}

export type AccountField = keyof AccountProfilePatch | 'appPassword' | 'username';

export type FieldErrorCode = 'required' | 'invalidEmail' | 'accountMismatch';

export type FieldErrors = Partial<Record<AccountField, FieldErrorCode>>;

export class AccountFieldError extends Error {
  readonly fields: FieldErrors;

  constructor(fields: FieldErrors) {
    super(`Invalid account fields: ${Object.keys(fields).join(', ')}`);
    this.name = 'AccountFieldError';
    this.fields = fields;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalize(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.trim();
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// Deterministic per-account accent used on merged views (agenda tag, legend).
// Derived from the account id so it survives list reordering — not user-picked.
const ACCOUNT_TAG_COLORS = [
  '#0082c9', '#2d9f5d', '#b250c7', '#d97706',
  '#d63b5c', '#0e9594', '#7a6ff0', '#8a6d3b',
] as const;

export function accountTagColor(accountId: string): string {
  let hash = 0;
  for (const ch of accountId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return ACCOUNT_TAG_COLORS[hash % ACCOUNT_TAG_COLORS.length];
}

// Compact "Name · host" tag — the Penpot multi-account language. Skips the
// host when the display name already spells it out.
export function accountTagLabel(account: Account): string {
  const name = account.displayName || account.username;
  const host = hostnameOf(account.baseUrl);
  return name && name !== host ? `${name} · ${host}` : name || host;
}

export function diffProfile(account: Account, patch: AccountProfilePatch): AccountProfilePatch {
  const changes: AccountProfilePatch = {};
  const displayName = normalize(patch.displayName);
  const email = normalize(patch.email);
  if (displayName !== undefined && displayName !== account.displayName) {
    changes.displayName = displayName;
  }
  if (email !== undefined && email !== (account.email ?? '')) {
    changes.email = email;
  }
  return changes;
}

export function validateProfilePatch(patch: AccountProfilePatch): FieldErrors | null {
  const errors: FieldErrors = {};

  if (patch.displayName !== undefined && !patch.displayName.trim()) {
    errors.displayName = 'required';
  }

  const email = normalize(patch.email);
  if (email && !EMAIL_RE.test(email)) {
    errors.email = 'invalidEmail';
  }

  return Object.keys(errors).length > 0 ? errors : null;
}
