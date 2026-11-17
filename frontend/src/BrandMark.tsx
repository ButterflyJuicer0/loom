// Loom's mark beside its name: a plain weave, three ribbons across three, each
// cut where it passes under the other. The path data is generated (ribbons at
// 17.5 / 32 / 46.5 of a 64 box, 9 wide, a 1.9 gap at each crossing), not drawn
// by hand. Its two leather browns are --brand-a and --brand-b (theme.css).
import { useId } from "react"

const WEFT = [
  "M7.5 13L24.4 13A1.2 1.2 0 0 1 25.6 14.2L25.6 20.8A1.2 1.2 0 0 1 24.4 22L7.5 22A4.5 4.5 0 0 1 3 17.5L3 17.5A4.5 4.5 0 0 1 7.5 13Z",
  "M39.6 13L56.5 13A4.5 4.5 0 0 1 61 17.5L61 17.5A4.5 4.5 0 0 1 56.5 22L39.6 22A1.2 1.2 0 0 1 38.4 20.8L38.4 14.2A1.2 1.2 0 0 1 39.6 13Z",
  "M7.5 27.5L9.9 27.5A1.2 1.2 0 0 1 11.1 28.7L11.1 35.3A1.2 1.2 0 0 1 9.9 36.5L7.5 36.5A4.5 4.5 0 0 1 3 32L3 32A4.5 4.5 0 0 1 7.5 27.5Z",
  "M25.1 27.5L38.9 27.5A1.2 1.2 0 0 1 40.1 28.7L40.1 35.3A1.2 1.2 0 0 1 38.9 36.5L25.1 36.5A1.2 1.2 0 0 1 23.9 35.3L23.9 28.7A1.2 1.2 0 0 1 25.1 27.5Z",
  "M54.1 27.5L56.5 27.5A4.5 4.5 0 0 1 61 32L61 32A4.5 4.5 0 0 1 56.5 36.5L54.1 36.5A1.2 1.2 0 0 1 52.9 35.3L52.9 28.7A1.2 1.2 0 0 1 54.1 27.5Z",
  "M7.5 42L24.4 42A1.2 1.2 0 0 1 25.6 43.2L25.6 49.8A1.2 1.2 0 0 1 24.4 51L7.5 51A4.5 4.5 0 0 1 3 46.5L3 46.5A4.5 4.5 0 0 1 7.5 42Z",
  "M39.6 42L56.5 42A4.5 4.5 0 0 1 61 46.5L61 46.5A4.5 4.5 0 0 1 56.5 51L39.6 51A1.2 1.2 0 0 1 38.4 49.8L38.4 43.2A1.2 1.2 0 0 1 39.6 42Z",
].join("")

const WARP = [
  "M13 7.5L13 9.9A1.2 1.2 0 0 0 14.2 11.1L20.8 11.1A1.2 1.2 0 0 0 22 9.9L22 7.5A4.5 4.5 0 0 0 17.5 3L17.5 3A4.5 4.5 0 0 0 13 7.5Z",
  "M13 25.1L13 38.9A1.2 1.2 0 0 0 14.2 40.1L20.8 40.1A1.2 1.2 0 0 0 22 38.9L22 25.1A1.2 1.2 0 0 0 20.8 23.9L14.2 23.9A1.2 1.2 0 0 0 13 25.1Z",
  "M13 54.1L13 56.5A4.5 4.5 0 0 0 17.5 61L17.5 61A4.5 4.5 0 0 0 22 56.5L22 54.1A1.2 1.2 0 0 0 20.8 52.9L14.2 52.9A1.2 1.2 0 0 0 13 54.1Z",
  "M27.5 7.5L27.5 24.4A1.2 1.2 0 0 0 28.7 25.6L35.3 25.6A1.2 1.2 0 0 0 36.5 24.4L36.5 7.5A4.5 4.5 0 0 0 32 3L32 3A4.5 4.5 0 0 0 27.5 7.5Z",
  "M27.5 39.6L27.5 56.5A4.5 4.5 0 0 0 32 61L32 61A4.5 4.5 0 0 0 36.5 56.5L36.5 39.6A1.2 1.2 0 0 0 35.3 38.4L28.7 38.4A1.2 1.2 0 0 0 27.5 39.6Z",
  "M42 7.5L42 9.9A1.2 1.2 0 0 0 43.2 11.1L49.8 11.1A1.2 1.2 0 0 0 51 9.9L51 7.5A4.5 4.5 0 0 0 46.5 3L46.5 3A4.5 4.5 0 0 0 42 7.5Z",
  "M42 25.1L42 38.9A1.2 1.2 0 0 0 43.2 40.1L49.8 40.1A1.2 1.2 0 0 0 51 38.9L51 25.1A1.2 1.2 0 0 0 49.8 23.9L43.2 23.9A1.2 1.2 0 0 0 42 25.1Z",
  "M42 54.1L42 56.5A4.5 4.5 0 0 0 46.5 61L46.5 61A4.5 4.5 0 0 0 51 56.5L51 54.1A1.2 1.2 0 0 0 49.8 52.9L43.2 52.9A1.2 1.2 0 0 0 42 54.1Z",
].join("")

export function BrandMark() {
  const id = useId()
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={id + "h"} gradientUnits="userSpaceOnUse" x1="3" y1="0" x2="61" y2="0">
          <stop offset="0" style={{ stopColor: "var(--brand-a)" }} />
          <stop offset="1" style={{ stopColor: "var(--brand-b)" }} />
        </linearGradient>
        <linearGradient id={id + "v"} gradientUnits="userSpaceOnUse" x1="0" y1="3" x2="0" y2="61">
          <stop offset="0" style={{ stopColor: "var(--brand-b)" }} />
          <stop offset="1" style={{ stopColor: "var(--brand-a)" }} />
        </linearGradient>
      </defs>
      <path fill={`url(#${id}h)`} d={WEFT} />
      <path fill={`url(#${id}v)`} d={WARP} />
    </svg>
  )
}
