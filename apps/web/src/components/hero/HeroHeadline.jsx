import { HERO } from "@/content/hero";

import MorphingTitle from "./MorphingTitle";

// Left column of the stage: the morphing headline, one line of context, actions.
export default function HeroHeadline() {
  return (
    <div className="headline">
      <MorphingTitle />

      <p className="headline__lede">{HERO.lede}</p>

      <div className="headline__actions">
        {HERO.actions.map((action) => (
          <a key={action.href} className={`btn btn--${action.variant}`} href={action.href}>
            {action.label}
          </a>
        ))}
      </div>
    </div>
  );
}
