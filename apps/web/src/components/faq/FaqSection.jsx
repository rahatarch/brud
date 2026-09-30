import { FAQ } from "@/content/faq";

/**
 * FAQ accordion.
 *
 * Built on <details>/<summary>, so it opens and closes with no JavaScript and
 * no hydration: the browser gives us the button semantics, the expanded state
 * and keyboard handling for free, and the answers are in the markup for
 * search engines. The shared `name` makes it a true accordion, closing the
 * open item when another is opened; browsers without that still work, they
 * just allow several open at once.
 */
export default function FaqSection() {
  return (
    <section className="faq" id="faq">
      <header className="faq__head">
        <p className="faq__eyebrow">{FAQ.eyebrow}</p>
        <h2 className="faq__title">{FAQ.title}</h2>
        <p className="faq__lede">{FAQ.lede}</p>
      </header>

      <div className="faq__list">
        {FAQ.items.map((item) => (
          <details key={item.q} className="faq__item" name="faq">
            <summary className="faq__q">
              <span className="faq__q-text">{item.q}</span>
              <span className="faq__sign" aria-hidden="true" />
            </summary>
            <div className="faq__a">
              <p className="faq__a-text">{item.a}</p>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
