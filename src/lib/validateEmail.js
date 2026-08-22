/**
 * Whether a string is a plausible email address.
 *
 * Signup checked only that the field was non-empty, so `connect.vidwangowda@gma`
 * was accepted: an address with no dot after the @, and therefore no top-level
 * domain. Nothing downstream catches it either — the confirmation mail is sent
 * to a domain that cannot resolve, and the account is left stranded:
 * unconfirmed, impossible to log into, and holding an address its owner cannot
 * register again.
 *
 * `type="email"` on the input does not help. The HTML5 definition is
 * deliberately looser than real-world addressing and treats `x@gma` as valid,
 * because a dotless intranet host is legal in principle. It is not what anybody
 * is typing into a consumer signup form.
 *
 * This is deliberately NOT RFC 5322. That grammar permits quoted local parts,
 * comments and bracketed IP literals; matching it exactly would admit more
 * unusable addresses, not fewer. The rule below is the one that matters here:
 * something before the @, a domain, and a real top-level domain of at least two
 * letters.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

/**
 * Trims before testing, because a trailing space from autofill or a paste is a
 * typo rather than a different address.
 */
export function isValidEmail(value) {
  return EMAIL_PATTERN.test(String(value ?? '').trim());
}
