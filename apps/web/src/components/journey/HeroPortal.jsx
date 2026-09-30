/**
 * The reveal of the next section.
 *
 * `portal` is a still, full-screen copy of the section that follows. It never
 * moves; it only fades up.
 *
 * `shroud` is what hides it: a canvas the size of the viewport, filled with
 * the hero's background colour and with the mark's silhouette punched out of
 * it. Journey redraws that one hole per frame, so the reveal grows without
 * anything on the page being masked, clipped or scaled.
 *
 * Both are visual only: hidden from assistive tech and inert, because the
 * real section follows in the document.
 */
export default function HeroPortal({ children }) {
  return (
    <>
      <div className="portal" data-journey-portal="" aria-hidden="true" inert>
        <div className="portal__content" data-journey-content="">
          {children}
        </div>
      </div>

      <canvas className="shroud" data-journey-shroud="" aria-hidden="true" />
    </>
  );
}
