export type CatGait = "walk" | "run";

type Point = { readonly x: number; readonly y: number };
type Step = { position: "front" | "back"; depth: "near" | "far"; start: number };

export const CAT_LEG_JOINTS = {
  front: { hip: { x: 55, y: 58 }, knee: { x: 56, y: 66 }, ankle: { x: 56, y: 74 } },
  back: { hip: { x: 26, y: 58 }, knee: { x: 28, y: 66 }, ankle: { x: 25, y: 74 } },
} as const;

const STEPS: Record<CatGait, readonly Step[]> = {
  walk: [
    { position: "back", depth: "near", start: 0.75 },
    { position: "front", depth: "near", start: 0 },
    { position: "back", depth: "far", start: 0.25 },
    { position: "front", depth: "far", start: 0.5 },
  ],
  run: [
    { position: "back", depth: "near", start: 0 },
    { position: "back", depth: "far", start: 0.08 },
    { position: "front", depth: "near", start: 0.3 },
    { position: "front", depth: "far", start: 0.38 },
  ],
};

const stanceDuration = (gait: CatGait) => gait === "walk" ? 0.65 : 0.26;
const wrap = (value: number) => (value % 1 + 1) % 1;
const format = (value: number) => Number(value.toFixed(5)).toString();
const angle = (from: Point, to: Point) => Math.atan2(to.y - from.y, to.x - from.x);
const distance = (from: Point, to: Point) => Math.hypot(to.x - from.x, to.y - from.y);

function bodyMotion(gait: CatGait, progress: number) {
  if (gait === "walk") return { base: 2.35 + 0.25 * Math.cos(4 * Math.PI * progress), flight: 0 };
  const compression = progress < 0.64 ? 0.65 * Math.sin(Math.PI * (progress % 0.32) / 0.32) ** 2 : 0;
  const flight = progress > 0.64 ? -5.5 * Math.sin(Math.PI * (progress - 0.64) / 0.36) ** 2 : 0;
  return { base: 2.1 + compression, flight };
}

function pawMotion(gait: CatGait, step: Step, progress: number) {
  const phase = wrap(progress - step.start);
  const stance = stanceDuration(gait);
  const stride = 5.5;
  if (phase <= stance) return { x: stride - 2 * stride * phase / stance, lift: 0, pitch: 0 };

  const swing = (phase - stance) / (1 - stance);
  const squared = swing * swing;
  const cubed = squared * swing;
  const velocity = -2 * stride * (1 - stance) / stance;
  // Match stance velocity at both ends instead of snapping the paw into its return stroke.
  const x = (2 * cubed - 3 * squared + 1) * -stride
    + (cubed - 2 * squared + swing) * velocity
    + (-2 * cubed + 3 * squared) * stride
    + (cubed - squared) * velocity;
  const lift = Math.sin(Math.PI * swing) ** 2;
  return { x, lift: (gait === "walk" ? 3.2 : 3.4) * lift, pitch: (gait === "walk" ? -12 : -18) * lift };
}

function legPose(gait: CatGait, step: Step, progress: number) {
  const { hip, knee, ankle } = CAT_LEG_JOINTS[step.position];
  const paw = pawMotion(gait, step, progress);
  const { base } = bodyMotion(gait, progress);
  // The paw pad extends 4.5 units below this ankle plane, giving a ground line at y=78.5.
  const target = { x: hip.x + paw.x, y: 74 - base - paw.lift };
  const upperLength = distance(hip, knee);
  const lowerLength = distance(knee, ankle);
  const reach = distance(hip, target);
  if (reach >= upperLength + lowerLength || reach <= Math.abs(upperLength - lowerLength)) {
    throw new Error(`Unreachable ${gait} ${step.position} paw target at ${format(progress * 100)}%`);
  }
  const bend = Math.acos((upperLength ** 2 + reach ** 2 - lowerLength ** 2) / (2 * upperLength * reach));
  const upperDirection = angle(hip, target) + (step.position === "front" ? bend : -bend);
  const joint = { x: hip.x + upperLength * Math.cos(upperDirection), y: hip.y + upperLength * Math.sin(upperDirection) };
  const upper = (upperDirection - angle(hip, knee)) * 180 / Math.PI;
  const lower = (angle(joint, target) - angle(knee, ankle)) * 180 / Math.PI - upper;
  return { upper, lower, paw: paw.pitch - upper - lower };
}

function sampleTimes(gait: CatGait) {
  const times = Array.from({ length: 49 }, (_, index) => index / 48);
  const stance = stanceDuration(gait);
  for (const step of STEPS[gait]) {
    times.push(step.start, wrap(step.start + stance), wrap(step.start + stance + (1 - stance) / 2));
  }
  if (gait === "run") times.push(0.16, 0.32, 0.48, 0.64, 0.8, 0.82);
  return [...new Set(times.map(value => Number(value.toFixed(8))))].sort((left, right) => left - right);
}

function keyframes(name: string, times: number[], sample: (progress: number, index: number) => string) {
  return `@keyframes ${name}{${times.map((progress, index) => `${format(progress * 100)}%{${sample(progress, index)}}`).join("")}}`;
}

// Bake coordinated joint angles into CSS once; playback never needs a JavaScript frame loop.
export function createCatGaitKeyframes() {
  let styles = "";
  for (const gait of ["walk", "run"] as const) {
    const times = sampleTimes(gait);
    styles += keyframes(`catalogue-cat-${gait}`, times, progress => {
      const { base, flight } = bodyMotion(gait, progress);
      return `transform:translateY(${format(base + flight)}px)`;
    });
    styles += keyframes(`catalogue-cat-${gait}-head`, times, progress => {
      const { base } = bodyMotion(gait, progress);
      return gait === "walk"
        ? `transform:translateY(${format(-(base - 2.35) * 0.6)}px) rotate(${format(0.7 * Math.sin(2 * Math.PI * progress))}deg)`
        : `transform:translate(1.5px,${format(2.8 - (base - 2.1) * 0.6)}px) rotate(${format(3 + Math.cos(2 * Math.PI * (progress - 0.3)))}deg)`;
    });
    for (const step of STEPS[gait]) {
      const poses = times.map(progress => legPose(gait, step, progress));
      for (const part of ["upper", "lower", "paw"] as const) {
        styles += keyframes(`catalogue-cat-${gait}-${step.position}-${step.depth}-${part}`, times,
          (_, index) => `transform:rotate(${format(poses[index][part])}deg)`);
      }
    }
    if (gait === "run") {
      styles += keyframes("catalogue-cat-run-spine", times, progress => {
        const extension = 0.07 * Math.cos(2 * Math.PI * (progress - 0.3));
        return `transform:scale(${format(1 + extension)},${format(1 - extension / 2)})`;
      });
      styles += keyframes("catalogue-cat-run-shadow", times, progress => {
        const lift = -bodyMotion(gait, progress).flight / 5.5;
        return `transform:scaleX(${format(1 - 0.25 * lift)});opacity:${format(1 - 0.55 * lift)}`;
      });
    }
  }
  return styles;
}
