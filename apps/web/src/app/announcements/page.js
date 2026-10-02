import HeroNav from "@/components/hero/HeroNav";
import FooterSection from "@/components/footer/FooterSection";
import { ANNOUNCEMENTS } from "@/content/announcements";

export default function AnnouncementsPage() {
  const { eyebrow, product, tagline, subtitle, thesis, divide, chapters, manifesto } =
    ANNOUNCEMENTS;

  return (
    <>
      <HeroNav />

      <main className="announcements">
        <div className="announcements__hero">
          <p className="announcements__eyebrow">{eyebrow}</p>
          <h1 className="announcements__product">{product}</h1>
          <p className="announcements__tagline">{tagline}</p>
          <p className="announcements__subtitle">{subtitle}</p>
        </div>

        <section className="announcements__thesis">
          <blockquote className="announcements__thesis-quote">{thesis}</blockquote>
        </section>

        <section className="announcements__divide">
          <div className="announcements__divide-col">
            <h3 className="announcements__divide-name">{divide.openSource.name}</h3>
            <span className="announcements__divide-model">{divide.openSource.model}</span>
            <span className="announcements__divide-role">{divide.openSource.role}</span>
            <p className="announcements__divide-desc">{divide.openSource.desc}</p>
          </div>
          <div className="announcements__divide-col">
            <h3 className="announcements__divide-name">{divide.flagship.name}</h3>
            <span className="announcements__divide-model">{divide.flagship.model}</span>
            <span className="announcements__divide-role">{divide.flagship.role}</span>
            <p className="announcements__divide-desc">{divide.flagship.desc}</p>
          </div>
        </section>

        <section className="announcements__chapters">
          {chapters.map((ch) => (
            <article key={ch.num} className="announcements__chapter">
              <span className="announcements__chapter-index">{ch.num}</span>
              <div className="announcements__chapter-body">
                <p className="announcements__chapter-tag">{ch.tag}</p>
                <h2 className="announcements__chapter-name">{ch.name}</h2>
                <p className="announcements__chapter-desc">{ch.desc}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="announcements__manifesto">
          <span className="announcements__manifesto-label">The Manifest</span>
          <blockquote className="announcements__manifesto-text">{manifesto}</blockquote>
        </section>
      </main>

      <FooterSection />
    </>
  );
}