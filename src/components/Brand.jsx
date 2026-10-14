import logoUrl from '../assets/almajdouie-logo-white.png';

// Brand pieces taken from the NPS orientation deck: the white Almajdouie logo
// (it only works on brand blue), the blue "title slide" page and the footer line.
export const BRAND_FOOTER = 'Almajdouie Motors | CX & Digital Transformation';

export function Logo({ className = '' }) {
  return <img className={`logo ${className}`.trim()} src={logoUrl} alt="Almajdouie" width="390" height="124" />;
}

/** Full-bleed brand-blue page with the logo top left, like the deck's title and quiz slides. */
export function BluePage({ className = '', children, footer = BRAND_FOOTER, aside }) {
  return (
    <main className={`blue-page on-blue surface-blue ${className}`.trim()}>
      <header className="blue-page__top">
        <Logo />
        {aside}
      </header>
      <div className="blue-page__body">{children}</div>
      {footer && <footer className="brand-foot">{footer}</footer>}
    </main>
  );
}
