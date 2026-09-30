import { HERO } from "@/content/hero";

// Row three of the frame: the fact strip that closes the composition.
export default function HeroMeta() {
  return (
    <footer className="hero__meta">
      <ul className="meta__list">
        {HERO.facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
    </footer>
  );
}
