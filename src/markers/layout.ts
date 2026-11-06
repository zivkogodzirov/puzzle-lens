/**
 * The printed markers (PLAN §2, RESEARCH §5): ArUco DICT_4X4_50, ids 0–7, 4 per A4 sheet.
 *
 * Each marker is printed on a square card: a 54 mm marker (6 × 6 cells of 9 mm, black border
 * included) inside an 18 mm white quiet zone, so the card is 90 mm across. The owner cuts the
 * cards out and lays them around the sorting area, clockwise from the far-left corner:
 *
 *      0 ──── 1 ──── 2
 *      │             │
 *      7   pieces    3
 *      │             │
 *      6 ──── 5 ──── 4
 *
 * The exact positions don't matter: the marker map photo measures them (src/geo/markerMap.ts).
 */
export const MARKER_DICTIONARY = 'DICT_4X4_50' as const;
export const MARKER_COUNT = 8;
export const MARKER_CELLS = 6;
export const MARKER_CELL_MM = 9;
/** Side of the black square, as printed at 100 %. */
export const MARKER_SIZE_MM = MARKER_CELLS * MARKER_CELL_MM; // 54
export const MARKER_QUIET_MM = 18;
export const MARKER_CARD_MM = MARKER_SIZE_MM + 2 * MARKER_QUIET_MM; // 90
export const MARKERS_PER_SHEET = 4;
/** Length of the check bar printed on each sheet. */
export const CHECK_BAR_MM = 100;

/** Where each marker goes, as words for the setup screens. */
export const MARKER_PLACES: readonly string[] = [
  'far-left corner',
  'middle of the far side',
  'far-right corner',
  'middle of the right side',
  'near-right corner',
  'middle of the near side',
  'near-left corner',
  'middle of the left side',
];

/**
 * A suggested layout in table millimetres (origin at marker 0's centre, x to the right, y towards
 * you) for a sorting area of `areaW × areaH` mm. Used by the synthetic generator and for the
 * picture on the setup screen; the real positions come from the marker map photo.
 */
export function suggestedMarkerCentres(areaW = 700, areaH = 500): Array<[number, number]> {
  const gap = MARKER_CARD_MM / 2 + 10;
  const w = areaW + 2 * gap;
  const h = areaH + 2 * gap;
  return [
    [0, 0],
    [w / 2, 0],
    [w, 0],
    [w, h / 2],
    [w, h],
    [w / 2, h],
    [0, h],
    [0, h / 2],
  ];
}

/**
 * The 4 corners of a marker's black square in table mm, in OpenCV's order (top-left, top-right,
 * bottom-right, bottom-left as printed), for a marker centred at (cx, cy) and turned by `angleDeg`.
 */
export function markerCornersMm(cx: number, cy: number, angleDeg = 0, sizeMm = MARKER_SIZE_MM): Array<[number, number]> {
  const h = sizeMm / 2;
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return ([
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ] as Array<[number, number]>).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}
