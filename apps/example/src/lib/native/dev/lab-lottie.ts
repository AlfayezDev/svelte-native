/**
 * A hand-written Lottie animation for the foreign-views lab (SPEC.md, "Foreign views"): a blue dot that grows and shrinks once
 * a second (60 frames at 30 per second), as the object a `require`d `.json` file would give.
 */
const ease = { i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } };

export const labLottie = {
  v: "5.7.0",
  fr: 30,
  ip: 0,
  op: 60,
  w: 100,
  h: 100,
  nm: "pulse",
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: "dot",
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [50, 50, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 1, k: [{ t: 0, s: [60, 60, 100], ...ease }, { t: 30, s: [100, 100, 100], ...ease }, { t: 60, s: [60, 60, 100] }] },
      },
      ao: 0,
      shapes: [
        {
          ty: "gr",
          nm: "group",
          it: [
            { ty: "el", nm: "ellipse", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [60, 60] }, d: 1 },
            { ty: "fl", nm: "fill", c: { a: 0, k: [0.18, 0.55, 0.95, 1] }, o: { a: 0, k: 100 }, r: 1 },
            { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } },
          ],
        },
      ],
      ip: 0,
      op: 60,
      st: 0,
      bm: 0,
    },
  ],
};
