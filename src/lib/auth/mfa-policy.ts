import { configBool } from '@/lib/config';
import { requiresMfa } from './permissions';

/**
 * Whether this role must pass second-factor verification right now.
 *
 * A role is *eligible* for MFA by its permissions (`requiresMfa`); whether it is *enforced* is an
 * administrator setting (`security.require_mfa_for_admin`, on by default). Every place that
 * gates on MFA goes through here so they can never disagree.
 */
export function mfaRequiredFor(role: string): boolean {
  return requiresMfa(role) && configBool('security.require_mfa_for_admin');
}
