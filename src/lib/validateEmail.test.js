import { describe, expect, it } from 'vitest';

import { isValidEmail } from '@/lib/validateEmail';

describe('isValidEmail', () => {
  /**
   * The reported bug. Signup only checked the field was non-empty, so an
   * address with no top-level domain sailed through and produced an account
   * whose confirmation mail could never be delivered.
   */
  it('rejects an address with no top-level domain', () => {
    expect(isValidEmail('connect.vidwangowda@gma')).toBe(false);
  });

  it('accepts the address that one was a typo of', () => {
    expect(isValidEmail('connect.vidwangowda@gmail.com')).toBe(true);
  });

  it('accepts ordinary addresses', () => {
    expect(isValidEmail('explorer@example.com')).toBe(true);
    expect(isValidEmail('first.last@sub.domain.co.uk')).toBe(true);
    expect(isValidEmail('user+tag@example.org')).toBe(true);
    expect(isValidEmail('user_name@example-host.io')).toBe(true);
  });

  it('rejects the shapes people actually mistype', () => {
    expect(isValidEmail('no-at-sign.com'), 'missing @').toBe(false);
    expect(isValidEmail('@example.com'), 'nothing before the @').toBe(false);
    expect(isValidEmail('user@'), 'nothing after the @').toBe(false);
    expect(isValidEmail('user@example'), 'no dot in the domain').toBe(false);
    expect(isValidEmail('user@example.'), 'trailing dot, no TLD').toBe(false);
    expect(isValidEmail('user@example.c'), 'single-letter TLD').toBe(false);
    expect(isValidEmail('user@@example.com'), 'two @ signs').toBe(false);
    expect(isValidEmail('user name@example.com'), 'space in the local part').toBe(false);
    expect(isValidEmail('user@exam ple.com'), 'space in the domain').toBe(false);
  });

  it('rejects a TLD that is not letters', () => {
    // A numeric last label means an IP literal typed without brackets, which is
    // never what somebody signing up meant.
    expect(isValidEmail('user@192.168.0.1')).toBe(false);
  });

  it('treats surrounding whitespace as a typo, not a different address', () => {
    expect(isValidEmail('  explorer@example.com  ')).toBe(true);
    expect(isValidEmail('\texplorer@example.com\n')).toBe(true);
  });

  it('survives the empty and missing cases without throwing', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('   ')).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
  });
});
