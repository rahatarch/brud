import { BRUD_MARK_PATH, BRUD_MARK_VIEWBOX } from "./markGeometry";

// Small flat mark: nav wordmark and the round nav badge.
export default function BrudMark({ size = 22, color = "currentColor", className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={BRUD_MARK_VIEWBOX}
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path d={BRUD_MARK_PATH} fill={color} />
    </svg>
  );
}
