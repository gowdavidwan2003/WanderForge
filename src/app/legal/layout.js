import Footer from '@/components/layout/Footer';

/**
 * Shared shell for the legal pages.
 *
 * The pages themselves are server components — no state, no effects, nothing to
 * hydrate — so the text is in the HTML and renders whether or not the bundle
 * arrives. A privacy policy that needs JavaScript to be readable is a privacy
 * policy some people never read.
 *
 * The shared Footer is a client component (it uses styled-jsx), so a small
 * bundle does load. The prose does not wait for it.
 */
export default function LegalLayout({ children }) {
  return (
    <>
      <div className="legal">
        <div className="legal__inner">{children}</div>
      </div>
      <Footer />
    </>
  );
}
