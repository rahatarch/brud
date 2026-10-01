import BrudMark from "@/components/brand/BrudMark";
import FooterSection from "@/components/footer/FooterSection";
import { CONTRIBUTORS } from "@/content/contributors";

const NAV_LINKS = [
  { label: "Features", href: "/#features" },
  { label: "Install", href: "/#install" },
  { label: "Guide", href: "/#guide" },
  { label: "FAQ", href: "/#faq" },
];

function ExternalArrow() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
      <path d="M13 2h5v5" />
      <path d="M18 2L9 11" />
    </svg>
  );
}

function ContributorsBar() {
  return (
    <>
      <a className="wordmark" href="/">
        <span>Brud</span>
        <BrudMark size={23} />
        <span>Code</span>
      </a>

      <div className="switch">
        {NAV_LINKS.map((link) => (
          <a key={link.href} className="switch__item" href={link.href}>
            {link.label}
          </a>
        ))}
        <a
          className="switch__badge"
          href="https://github.com/rahatarch/brud"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Star Brud Code on GitHub"
          title="Star on GitHub"
        >
          <svg viewBox="0 0 16 16" width="19" height="19" aria-hidden="true" fill="#0D0E10">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
      </div>
    </>
  );
}

export default function ContributorsPage() {
  const { eyebrow, title, lede, spotlight, community } = CONTRIBUTORS;

  return (
    <>
      <header className="nav nav--fixed" data-stuck>
        <ContributorsBar />
      </header>

      <main className="contributors">
        <div className="contributors__head">
          <p className="contributors__eyebrow">{eyebrow}</p>
          <h1 className="contributors__title">{title}</h1>
          <p className="contributors__lede">{lede}</p>
        </div>

        <div className="monument-stage">
          <div className="monument-aura" aria-hidden="true" />

          <article className="monument-plaque">
            <span className="crosshair crosshair--tl" aria-hidden="true">+</span>
            <span className="crosshair crosshair--tr" aria-hidden="true">+</span>
            <span className="crosshair crosshair--bl" aria-hidden="true">+</span>
            <span className="crosshair crosshair--br" aria-hidden="true">+</span>

            <div className="registry-bar">
              <span className="registry-bar__beacon" aria-hidden="true" />
              <span className="registry-bar__text">
                {spotlight.registry} // {spotlight.era}
              </span>
            </div>

            <span className="monument-badge">{spotlight.badge}</span>

            <h2 className="monument-name">{spotlight.name}</h2>
            <span className="monument-handle">{spotlight.handle}</span>
            <span className="monument-role">{spotlight.title}</span>

            <div className="craft-chips">
              {spotlight.craftTags.map((tag) => (
                <span key={tag} className="craft-chip">{tag}</span>
              ))}
            </div>

            <div className="monument-citation">
              <p className="monument-citation__lead">{spotlight.citationLead}</p>
              <p className="monument-citation__body">{spotlight.citationBody}</p>
              <span className="monument-citation__signed">
                <span className="monument-citation__seal" aria-hidden="true">✦</span>
                {spotlight.signed}
              </span>
            </div>

            <a
              className="dossier-link"
              href={spotlight.github}
              target="_blank"
              rel="noopener noreferrer"
            >
              View GitHub Dossier
              <span className="dossier-link__arrow"><ExternalArrow /></span>
            </a>
          </article>
        </div>

        <section className="contributors__community">
          <h3 className="contributors__community-title">{community.title}</h3>
          <p className="contributors__community-desc">{community.description}</p>

          <div className="contributors__community-links">
            <a
              className="btn btn--solid"
              href={community.githubRepo}
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub Repository
            </a>
            <a
              className="btn btn--muted"
              href={community.contributingGuide}
              target="_blank"
              rel="noopener noreferrer"
            >
              Contributing Guide
            </a>
          </div>
        </section>
      </main>

      <FooterSection />
    </>
  );
}