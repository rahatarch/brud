import BrudGlyph from "@/components/brand/BrudGlyph";

import HeroBackdrop from "./HeroBackdrop";
import HeroHeadline from "./HeroHeadline";
import HeroMeta from "./HeroMeta";
import HeroNav from "./HeroNav";
import HeroPoints from "./HeroPoints";
import HeroPower from "./HeroPower";

/**
 * The hero is a three-row frame: nav, stage, meta.
 *
 * The art layer and the stage both occupy row two, so the mark is centred on
 * the same band the copy sits in without a single hand-tuned percentage. See
 * src/styles/hero.css for the grid itself.
 */
export default function Hero({ portal = null }) {
  return (
    <section className="hero">
      <HeroPower />

      <div className="hero__art" aria-hidden="true">
        <div className="hero__halo" />
        <div className="hero__mark">
          <BrudGlyph />
        </div>
      </div>

      <HeroBackdrop />

      <HeroNav />

      <div className="hero__stage">
        <HeroHeadline />
        <HeroPoints />
      </div>

      <HeroMeta />

      {portal}
    </section>
  );
}
