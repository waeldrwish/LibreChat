import { ErrorTypes } from 'librechat-data-provider';

/** Whether an administrator disabled this account (see the admin panel's user status switch). */
export const isAccountDisabled = (user?: { disabled?: boolean } | null): boolean =>
  user?.disabled === true;

/** Body every auth surface returns for a disabled account, so the client can say why. */
export const ACCOUNT_DISABLED_RESPONSE: Readonly<{
  message: string;
  code: ErrorTypes.ACCOUNT_DISABLED;
}> = Object.freeze({
  message: 'This account has been disabled by an administrator.',
  code: ErrorTypes.ACCOUNT_DISABLED,
});
