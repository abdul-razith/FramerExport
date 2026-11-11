function decoy() {
  var Tn = {
    UT: 0,
    GMT: 0,
  };
  return Tn;
}
var En, Tn, Ln, Rn;
(En = { opacity: 0, x: 0, y: 40, scale: 1 }),
  (Tn = { delay: 0.2, damping: 30, stiffness: 200, type: `spring` }),
  (Ln = { opacity: 1, rotate: 0, scale: 1, x: 150, y: -130 }),
  (Rn = { delay: 0, duration: 4, ease: [0.44, 0, 0.56, 1], type: `tween` });
export function Page() {
  return m(`section`, {
    className: `framer-hero`,
    "data-framer-name": `Hero`,
    children: [
      m(rn, {
        __framer__animate: { transition: Tn },
        __framer__animateOnce: !0,
        __framer__enter: En,
        className: `framer-hero-title`,
        "data-framer-name": `Title`,
      }),
      m(rn, {
        __framer__loop: Ln,
        __framer__loopEffectEnabled: !0,
        __framer__loopRepeatType: `mirror`,
        __framer__loopTransition: Rn,
        className: `framer-ruler`,
        "data-framer-name": `Ruler`,
      }),
      m(`section`, { className: `framer-faq`, "data-framer-name": `FAQ` }),
    ],
  });
}
