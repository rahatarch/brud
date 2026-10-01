import BrudMark from "@/components/brand/BrudMark";
import FooterSection from "@/components/footer/FooterSection";
import { ANNOUNCEMENTS } from "@/content/announcements";

const NAV_LINKS = [
  { label: "Features", href: "/#features" },
  { label: "Install", href: "/#install" },
  { label: "Guide", href: "/#guide" },
  { label: "FAQ", href: "/#faq" },
];

function AnnouncementsBar() {
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

function AnnouncementCard({ item }) {
  const badgeClass =
    item.badgeStyle === "warning"
      ? "announcements__badge--warning"
      : "announcements__badge--accent";

  return (
    <article className="announcements__card">
      <div className="announcements__meta">
        <span className="announcements__type">{item.type}</span>
        <span className={`announcements__badge ${badgeClass}`}>{item.tag}</span>
      </div>

      <div className="announcements__status">
        <span className="announcements__status-item">
          <span className="announcements__status-dot" />
          {item.status}
        </span>
        <span>{item.date}</span>
      </div>

      <h3 className="announcements__card-title">{item.title}</h3>
      <p className="announcements__summary">{item.summary}</p>

      <ul className="announcements__details">
        {item.details.map((detail, i) => (
          <li key={i} className="announcements__detail">
            {detail}
          </li>
        ))}
      </ul>
    </article>
  );
}

export default function AnnouncementsPage() {
  const { eyebrow, title, lede, items } = ANNOUNCEMENTS;

  return (
    <>
      <header className="nav nav--fixed" data-stuck>
        <AnnouncementsBar />
      </header>

      <main className="announcements">
        <div className="announcements__head">
          <p className="announcements__eyebrow">{eyebrow}</p>
          <h1 className="announcements__title">{title}</h1>
          <p className="announcements__lede">{lede}</p>
        </div>

        <div className="announcements__feed">
          {items.map((item, i) => (
            <AnnouncementCard key={i} item={item} />
          ))}
        </div>
      </main>

      <FooterSection />
    </>
  );
}