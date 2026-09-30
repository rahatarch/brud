// Full-bleed scrim: sits above the art layer and below every piece of copy,
// so the vignette bites into the mark's glow the same way it does the edges.
//
// The three layers share one wrapper so the journey can fade them out
// together as the reveal opens. Without that they would tint the section
// showing through the mark, and then snap away at the handover.
export default function HeroBackdrop() {
  return (
    <div className="hero__scrim" data-hero-scrim="" aria-hidden="true">
      <div className="hero__vignette" />
      <div className="hero__grain" />
      <div className="hero__floor" />
    </div>
  );
}
