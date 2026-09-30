import { expect, test, type Locator, type Page } from "@playwright/test";
import type { CompanionChatPreviewController, CompanionChatPreviewState } from "./cat-companion-browser-harness";

declare global {
  interface Window {
    catChatPreview?: CompanionChatPreviewController;
  }
}

async function mountChatPreview(page: Page, initial: Partial<CompanionChatPreviewState> = {}) {
  await page.evaluate(async initial => {
    const modulePath = "/cat-companion-browser-harness.tsx";
    const preview: typeof import("./cat-companion-browser-harness") = await import(modulePath);
    window.catChatPreview = preview.mountCompanionChatPreview(initial);
  }, initial);
  const pane = page.getByTestId("cat-chat-preview");
  await expect(pane.locator("[data-chat-companion]")).toHaveCount(1);
  return { pane, cat: pane.locator(".cat-companion") };
}

async function updateChatPreview(page: Page, patch: Partial<CompanionChatPreviewState>) {
  await page.evaluate(patch => {
    if (!window.catChatPreview) throw new Error("Chat preview is not mounted");
    window.catChatPreview.setState(patch);
  }, patch);
}

async function seek(preview: Locator, milliseconds: number) {
  await preview.evaluate((element, time) => {
    for (const animation of element.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = time;
    }
  }, milliseconds);
}

async function pose(locator: Locator) {
  return locator.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const transform = getComputedStyle(element).transform;
    const matrix = transform === "none" ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
    return {
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      scaleX: Math.hypot(matrix.a, matrix.b),
      scaleY: Math.hypot(matrix.c, matrix.d),
      angle: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
      translateY: matrix.f,
    };
  });
}

async function sampleGait(preview: Locator, duration: number, phases: number[]) {
  return preview.evaluate((element, { duration, phases }) => {
    const svg = element.querySelector("svg");
    const torso = element.querySelector(".pet-cat-silhouette");
    const puppet = element.querySelector(".pet-puppet");
    const spine = element.querySelector(".pet-cat-body");
    const shadow = element.querySelector(".pet-shadow");
    if (!(svg instanceof SVGSVGElement) || !(torso instanceof SVGPathElement) || !(puppet instanceof SVGGraphicsElement)
      || !(spine instanceof SVGGraphicsElement) || !(shadow instanceof SVGGraphicsElement)) {
      throw new Error("Missing animated cat rig");
    }
    const outline = (path: SVGPathElement) => {
      const length = path.getTotalLength();
      return { path, points: Array.from({ length: 101 }, (_, index) => path.getPointAtLength(length * index / 100)) };
    };
    const body = outline(torso);
    const feet = Array.from(element.querySelectorAll(".pet-cat-leg")).map(leg => {
      const path = leg.querySelector(".pet-cat-foot");
      const paw = leg.querySelector(".pet-cat-paw-motion");
      if (!(path instanceof SVGPathElement) || !(paw instanceof SVGGraphicsElement)) throw new Error("Missing articulated paw");
      const [x, y] = getComputedStyle(paw).transformOrigin.split(" ").map(value => parseFloat(value));
      return {
        ...outline(path), paw, ankle: new DOMPoint(x, y),
        id: `${leg.classList.contains("pet-cat-leg-front") ? "front" : "back"}-${leg.classList.contains("pet-cat-leg-near") ? "near" : "far"}`,
      };
    });
    const animations = element.getAnimations({ subtree: true });
    for (const animation of animations) animation.pause();
    const transformOf = (part: Element) => {
      const transform = getComputedStyle(part).transform;
      return transform === "none" ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
    };
    return phases.map(progress => {
      for (const animation of animations) animation.currentTime = duration * progress;
      const screen = svg.getScreenCTM();
      if (!screen) throw new Error("Cat viewport has no transform");
      const inverse = screen.inverse();
      const matrixFor = (part: SVGGraphicsElement) => {
        const matrix = part.getScreenCTM();
        if (!matrix) throw new Error("Cat part has no transform");
        return inverse.multiply(matrix);
      };
      const bottom = (part: ReturnType<typeof outline>) => {
        const matrix = matrixFor(part.path);
        return Math.max(...part.points.map(point => point.matrixTransform(matrix).y));
      };
      return {
        progress, bodyY: matrixFor(puppet).f,
        torsoBottom: bottom(body),
        spineScale: transformOf(spine).a,
        shadowScale: transformOf(shadow).a,
        feet: feet.map(foot => {
          const matrix = matrixFor(foot.paw);
          const ankle = foot.ankle.matrixTransform(matrix);
          return { id: foot.id, x: ankle.x, y: ankle.y, bottom: bottom(foot), angle: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI };
        }),
      };
    });
  }, { duration, phases });
}

async function catCharacter(locator: Locator) {
  return locator.evaluate(element => {
    const shape = (selector: string) => {
      const match = element.querySelector(selector);
      if (!(match instanceof SVGGraphicsElement)) throw new Error(`Missing cat feature: ${selector}`);
      return match;
    };
    const eye = shape(".pet-eye-dot");
    const shine = shape(".pet-eye-shine");
    const cheek = shape(".pet-blush");
    if (!(eye instanceof SVGEllipseElement) || !(shine instanceof SVGCircleElement) || !(cheek instanceof SVGEllipseElement)) {
      throw new Error("The kitten must retain its round eyes, highlights, and cheeks");
    }
    const face = shape(".pet-cat-face").getBBox();
    const tail = getComputedStyle(shape(".pet-cat-tail > .pet-tail-stroke"));
    return {
      face: { width: face.width, height: face.height },
      features: {
        eye: { rx: eye.rx.baseVal.value, ry: eye.ry.baseVal.value, fill: getComputedStyle(eye).fill },
        shine: { radius: shine.r.baseVal.value, fill: getComputedStyle(shine).fill },
        cheek: { rx: cheek.rx.baseVal.value, ry: cheek.ry.baseVal.value, fill: getComputedStyle(cheek).fill },
        forehead: { path: shape(".pet-cat-forehead-markings").getAttribute("d"), fill: getComputedStyle(shape(".pet-cat-forehead-markings")).fill },
        fur: getComputedStyle(shape(".pet-cat-face")).fill,
        nose: getComputedStyle(shape(".pet-nose")).fill,
        ear: getComputedStyle(shape(".pet-inner-ear")).fill,
        tail: { stroke: tail.stroke, width: tail.strokeWidth },
      },
    };
  });
}

test.beforeEach(async ({ page, baseURL }) => {
  await page.clock.install({ time: new Date(2026, 8, 29, 12) });
  const origin = new URL(baseURL!).origin;
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === origin && !/^\/(?:api|auth)(?:\/|$)/.test(url.pathname)
      ? route.continue() : route.abort();
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/preview/pet-animations");
  await expect(page.getByRole("heading", { name: "Companion animations", exact: true })).toBeVisible();
});

test("renders only the five shared cat poses at a readable size", async ({ page }, testInfo) => {
  const cats = page.getByRole("region", { name: "Cat animation catalogue" });
  await expect(cats.getByRole("img")).toHaveCount(5);
  for (const name of ["Sitting cat", "Walking cat", "Running cat", "Stretching cat", "Sleeping cat"]) {
    await expect(cats.getByRole("img", { name: `${name} preview`, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("radio", { name: "88 px", exact: true })).toBeChecked();
  expect((await pose(page.locator(".pet-artwork").first())).width).toBeCloseTo(88);
  await expect(page.getByRole("region", { name: "Atom animation catalogue" })).toHaveCount(0);
  await expect(page.locator('[data-pet]:not([data-pet="cat"]), .companion-atom')).toHaveCount(0);
  expect(await page.evaluate(() => Array.from(document.head.querySelectorAll("style"))
    .filter(style => style.textContent?.includes("@keyframes catalogue-cat-walk-front-near-upper")).length)).toBe(1);
  await expect(page.getByRole("link", { name: "Back to course builder" })).toHaveAttribute("href", "/create");
  await page.screenshot({ path: testInfo.outputPath("companion-catalogue.png"), fullPage: true });
});

test("side views preserve the sitting kitten's face, coat, and plush proportions", async ({ page }) => {
  await page.getByRole("button", { name: "Pause animations" }).click();
  const sitter = page.getByRole("img", { name: "Sitting cat preview", exact: true });
  await seek(sitter, 0);
  const reference = await catCharacter(sitter);
  const referencePaw = await sitter.locator(".pet-cat-paw").evaluate(element => {
    if (!(element instanceof SVGGraphicsElement)) throw new Error("Missing sitting paws");
    return element.getBBox().height;
  });
  const haunchColor = await sitter.locator(".pet-cat-body .pet-soft-shade").first().evaluate(element => getComputedStyle(element).fill);
  for (const name of ["Walking cat", "Running cat", "Stretching cat"]) {
    const cat = page.getByRole("img", { name: `${name} preview`, exact: true });
    await seek(cat, 0);
    const character = await catCharacter(cat);
    expect(character.features).toEqual(reference.features);
    expect(character.face.width / reference.face.width).toBeGreaterThan(0.7);
    expect(character.face.width / reference.face.width).toBeLessThan(0.95);
    expect(character.face.height / reference.face.height).toBeGreaterThan(0.9);
    expect(character.face.height / reference.face.height).toBeLessThan(1.12);
    await expect(cat.locator(".pet-eye-dot")).toHaveCount(1);
    await expect(cat.locator(".pet-cat-leg-back.pet-cat-leg-near .pet-cat-upper-leg")).toHaveCSS("fill", haunchColor);
    const anatomy = await cat.evaluate(element => {
      const measure = (selector: string) => {
        const shape = element.querySelector(selector);
        if (!(shape instanceof SVGGraphicsElement)) throw new Error(`Missing cat shape: ${selector}`);
        const bounds = shape.getBBox();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      };
      const joints = Array.from(element.querySelectorAll(".pet-cat-leg")).map(leg => {
        const upper = leg.querySelector(".pet-cat-upper-leg");
        const shank = leg.querySelector(".pet-cat-shank");
        const foot = leg.querySelector(".pet-cat-foot");
        const shin = leg.querySelector(".pet-cat-shin");
        const paw = leg.querySelector(".pet-cat-paw-motion");
        if (!(upper instanceof SVGGeometryElement) || !(shank instanceof SVGGeometryElement) || !(foot instanceof SVGGeometryElement)
          || !(shin instanceof SVGGraphicsElement) || !(paw instanceof SVGGraphicsElement)) {
          throw new Error("Missing filled cat limb");
        }
        const [x, y] = getComputedStyle(shin).transformOrigin.split(" ").map(value => parseFloat(value));
        const pivot = new DOMPoint(x, y);
        const [ankleX, ankleY] = getComputedStyle(paw).transformOrigin.split(" ").map(value => parseFloat(value));
        const ankle = new DOMPoint(ankleX, ankleY);
        const style = getComputedStyle(foot);
        return {
          connected: upper.isPointInFill(pivot) && shank.isPointInFill(pivot) && shank.isPointInFill(ankle) && foot.isPointInFill(ankle),
          fill: style.fill, stroke: style.stroke,
        };
      });
      const silhouette = element.querySelector(".pet-cat-silhouette");
      if (!(silhouette instanceof SVGGeometryElement)) throw new Error("Missing cat torso");
      const body = measure(".pet-cat-silhouette");
      const depthAt = (fraction: number) => {
        const occupied = [];
        for (let y = body.y; y < body.y + body.height; y += 0.25) {
          if (silhouette.isPointInFill(new DOMPoint(body.x + body.width * fraction, y))) occupied.push(y);
        }
        if (!occupied.length) throw new Error("Disconnected cat torso");
        return occupied[occupied.length - 1] - occupied[0];
      };
      return {
        foreleg: measure(".pet-cat-leg-front.pet-cat-leg-near"), joints,
        waist: depthAt(0.5), haunch: depthAt(0.25),
      };
    });
    expect(anatomy.foreleg.height).toBeLessThan(referencePaw * 1.4);
    expect(anatomy.waist).toBeGreaterThan(anatomy.haunch * 0.78);
    expect(anatomy.joints).toHaveLength(4);
    expect(anatomy.joints.every(joint => joint.connected && joint.fill !== "none" && joint.stroke === "none")).toBe(true);
  }
});

test("walking keeps two paws grounded with level stance and staggered recovery at every speed", async ({ page }) => {
  await page.getByRole("button", { name: "Pause animations" }).click();
  const cat = page.getByRole("img", { name: "Walking cat preview", exact: true });
  const contacts: Record<string, number> = { "front-near": 0, "back-far": 0.25, "front-far": 0.5, "back-near": 0.75 };
  const phases = Array.from({ length: 97 }, (_, index) => index / 96);
  for (const speed of [0.5, 1, 1.5]) {
    await page.getByRole("combobox", { name: "Animation speed" }).selectOption(String(speed));
    const frames = await sampleGait(cat, 1200 / speed, phases);
    for (const frame of frames) {
      expect(frame.feet.filter(foot => Math.abs(foot.bottom - 78.5) < 0.25).length, `Walking support at ${frame.progress}`).toBeGreaterThanOrEqual(2);
      for (const foot of frame.feet) {
        expect(foot.bottom, `Walking paw below ground: ${foot.id}`).toBeLessThanOrEqual(78.75);
        const phase = (frame.progress - contacts[foot.id] + 1) % 1;
        if (phase < 0.65) {
          expect(Math.abs(foot.bottom - 78.5), `Walking contact: ${foot.id} at ${frame.progress}`).toBeLessThan(0.15);
          expect(Math.abs(foot.angle)).toBeLessThan(0.3);
        }
      }
    }
    for (const [id, contact] of Object.entries(contacts)) {
      const pawFrames = frames.map(frame => ({ progress: frame.progress, foot: frame.feet.find(foot => foot.id === id)! }));
      const lifted = pawFrames.reduce((highest, frame) => frame.foot.bottom < highest.foot.bottom ? frame : highest);
      expect(lifted.foot.bottom).toBeLessThan(76.5);
      expect(Math.abs(lifted.progress - (contact + 0.825) % 1)).toBeLessThan(0.025);
      const planted = pawFrames.filter(frame => {
        const phase = (frame.progress - contact + 1) % 1;
        return phase > 0.03 && phase < 0.62;
      });
      const travel = planted.slice(1).flatMap((frame, index) =>
        frame.progress - planted[index].progress < 0.02 ? [frame.foot.x - planted[index].foot.x] : []);
      expect(Math.max(...travel)).toBeLessThan(-0.1);
      expect(Math.min(...travel)).toBeGreaterThan(-0.25);
      expect(Math.max(...travel) - Math.min(...travel)).toBeLessThan(0.03);
    }
  }
});

test("idle cats breathe, blink, twitch their ears, and move their tails", async ({ page }) => {
  await page.getByRole("button", { name: "Pause animations" }).click();
  const sitter = page.getByRole("img", { name: "Sitting cat preview", exact: true });
  await seek(sitter, 0);
  const openEyes = await pose(sitter.locator(".pet-eye"));
  await seek(sitter, 1632);
  expect((await pose(sitter.locator(".pet-eye"))).scaleY).toBeLessThan(openEyes.scaleY * 0.1);
  await seek(sitter, 3264);
  expect((await pose(sitter.locator(".pet-cat-ear-left"))).angle).toBeLessThan(-8);
  const sleeper = page.getByRole("img", { name: "Sleeping cat preview", exact: true });
  await seek(sleeper, 0);
  const restingBody = await pose(sleeper.locator(".pet-cat-body"));
  await seek(sleeper, 2160);
  expect((await pose(sleeper.locator(".pet-cat-body"))).height).toBeGreaterThan(restingBody.height * 1.04);
  await expect(sleeper.locator(".pet-closed-eye")).toBeVisible();
  await expect(sleeper.locator(".pet-eye")).toHaveCount(0);
  await expect(sleeper.locator(".pet-dream")).toHaveCount(3);
  await seek(sitter, 0);
  const tail = await pose(sitter.locator(".pet-cat-tail"));
  await seek(sitter, 1200);
  expect((await pose(sitter.locator(".pet-cat-tail"))).angle - tail.angle).toBeGreaterThan(15);
});

test("running coordinates hind-to-front contacts and a bounded suspension phase at every speed", async ({ page }) => {
  await page.getByRole("button", { name: "Pause animations" }).click();
  const cat = page.getByRole("img", { name: "Running cat preview", exact: true });
  const contacts: Record<string, number> = { "back-near": 0, "back-far": 0.08, "front-near": 0.3, "front-far": 0.38 };
  for (const speed of [0.5, 1, 1.5]) {
    await page.getByRole("combobox", { name: "Animation speed" }).selectOption(String(speed));
    const frames = await sampleGait(cat, 600 / speed, Array.from({ length: 101 }, (_, index) => index / 100));
    for (const frame of frames) {
      if (frame.progress <= 0.64 || frame.progress === 1) {
        expect(frame.feet.some(foot => Math.abs(foot.bottom - 78.5) < 0.25), `Running support at ${frame.progress}`).toBe(true);
      }
      for (const foot of frame.feet) {
        expect(foot.bottom, `Running paw below ground: ${foot.id}`).toBeLessThanOrEqual(78.75);
        expect(foot.bottom, `Running paw hidden by torso: ${foot.id}`).toBeGreaterThan(frame.torsoBottom + 0.5);
        const phase = (frame.progress - contacts[foot.id] + 1) % 1;
        if (phase < 0.26) {
          expect(Math.abs(foot.bottom - 78.5), `Running contact: ${foot.id} at ${frame.progress}`).toBeLessThan(0.15);
          expect(Math.abs(foot.angle)).toBeLessThan(0.3);
        }
        if (frame.progress >= 0.7 && frame.progress <= 0.96) expect(foot.bottom).toBeLessThan(78);
      }
    }
    const ground = frames[0];
    const airborne = frames[82];
    expect(ground.bodyY - airborne.bodyY).toBeGreaterThan(5);
    expect(ground.bodyY - airborne.bodyY).toBeLessThan(6);
    expect(airborne.shadowScale).toBeLessThan(ground.shadowScale * 0.8);
    expect(frames[80].spineScale).toBeLessThan(frames[30].spineScale * 0.9);
  }
});

test("walking and running close their loops without a paw or body jump", async ({ page }) => {
  await page.getByRole("button", { name: "Pause animations" }).click();
  for (const [name, duration] of [["Walking cat", 1200], ["Running cat", 600]] as const) {
    const frames = await sampleGait(page.getByRole("img", { name: `${name} preview`, exact: true }), duration, [0, 0.001, 0.999, 1]);
    expect(Math.abs(frames[2].bodyY - frames[0].bodyY)).toBeLessThan(0.05);
    for (let index = 0; index < frames[0].feet.length; index++) {
      const start = frames[0].feet[index];
      const end = frames[2].feet[index];
      expect(Math.hypot(start.x - end.x, start.y - end.y)).toBeLessThan(0.15);
      expect(Math.abs(start.angle - end.angle)).toBeLessThan(0.5);
      expect(frames[3].feet[index].bottom).toBeCloseTo(start.bottom, 3);
    }
  }
});

test("gait tracks stay synchronized during live playback and speed changes", async ({ page }) => {
  for (const speed of [1, 0.5, 1.5]) {
    await page.getByRole("combobox", { name: "Animation speed" }).selectOption(String(speed));
    const drift = await page.evaluate(async () => {
      let maximum = 0;
      for (let frame = 0; frame < 20; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        for (const gait of ["walk", "run"]) {
          const cat = document.querySelector(`[data-cat-action="${gait}"]`);
          if (!cat) throw new Error("Missing live gait");
          const tracks = cat.getAnimations({ subtree: true }).filter((animation): animation is CSSAnimation =>
            animation instanceof CSSAnimation && animation.animationName.startsWith(`catalogue-cat-${gait}`));
          const body = tracks.find(animation => animation.animationName === `catalogue-cat-${gait}`);
          const duration = body?.effect?.getComputedTiming().duration;
          const clock = body?.currentTime;
          if (tracks.length < 14 || typeof duration !== "number" || typeof clock !== "number") {
            throw new Error("Missing live gait clocks");
          }
          for (const track of tracks) {
            if (track.playState !== "running" || typeof track.currentTime !== "number") throw new Error("A gait track is not playing");
            const difference = Math.abs(track.currentTime - clock) % duration;
            maximum = Math.max(maximum, Math.min(difference, duration - difference) / duration);
          }
        }
      }
      return maximum;
    });
    expect(drift).toBeLessThan(0.005);
  }
});

test("stretches the shoulders and forepaws without translating the whole cat", async ({ page }) => {
  await page.getByRole("button", { name: "Pause animations" }).click();
  const cat = page.getByRole("img", { name: "Stretching cat preview", exact: true });
  const head = cat.locator(".pet-cat-head");
  const forepaw = cat.locator(".pet-cat-leg-front.pet-cat-leg-near .pet-cat-shin");
  const hindpaw = cat.locator(".pet-cat-leg-back.pet-cat-leg-near .pet-cat-shin");
  await seek(cat, 0);
  const resting = { head: await pose(head), forepaw: await pose(forepaw), hindpaw: await pose(hindpaw) };
  await seek(cat, 2400);
  expect((await pose(head)).y - resting.head.y).toBeGreaterThan(8);
  expect((await pose(forepaw)).x - resting.forepaw.x).toBeGreaterThan(8);
  expect(Math.abs((await pose(hindpaw)).y - resting.hindpaw.y)).toBeLessThan(2);
  expect((await pose(cat.locator(".pet-puppet"))).translateY).toBe(0);
  await seek(cat, 4800);
  expect((await pose(head)).y).toBeCloseTo(resting.head.y);
});

test("pause and resume cover every moving part, dream, and shadow", async ({ page }) => {
  const catalogue = page.locator(".companion-catalogue");
  await page.getByRole("button", { name: "Pause animations" }).click();
  await expect(catalogue).toHaveAttribute("data-playing", "false");
  const paused = await catalogue.evaluate(element => element.getAnimations({ subtree: true }).map(animation => ({
    state: animation.playState,
    tagged: animation.effect instanceof KeyframeEffect
      && animation.effect.target instanceof Element
      && animation.effect.target.hasAttribute("data-motion"),
  })));
  expect(paused.length).toBeGreaterThan(60);
  expect(paused.every(animation => animation.state === "paused" && animation.tagged)).toBe(true);
  const times = await catalogue.evaluate(async element => {
    const animations = element.getAnimations({ subtree: true });
    const before = animations.map(animation => animation.currentTime);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { before, after: animations.map(animation => animation.currentTime) };
  });
  expect(times.after).toEqual(times.before);
  await page.getByRole("button", { name: "Play animations" }).click();
  await expect(catalogue).toHaveAttribute("data-playing", "true");
  expect(await catalogue.evaluate(element => element.getAnimations({ subtree: true }).every(animation => animation.playState === "running"))).toBe(true);
});

test("speed and size controls preserve phase ratios and the paused state", async ({ page }) => {
  await page.getByRole("button", { name: "Pause animations" }).click();
  for (const speed of [0.5, 1, 1.5]) {
    await page.getByRole("combobox", { name: "Animation speed" }).selectOption(String(speed));
    const timing = await page.evaluate(() => {
      const read = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing animation: ${selector}`);
        const style = getComputedStyle(element);
        return { duration: parseFloat(style.animationDuration), delay: parseFloat(style.animationDelay) };
      };
      return {
        walk: read('[data-cat-action="walk"] .pet-cat-leg-front.pet-cat-leg-far'),
        run: read('[data-cat-action="run"] .pet-puppet'),
        shadow: read('[data-cat-action="run"] .pet-shadow'),
        stretch: read('[data-cat-action="stretch"] .pet-cat-body'),
        dream: read(".pet-dream:nth-child(2)"),
      };
    });
    expect(timing.walk.duration).toBeCloseTo(1.2 / speed);
    const [walk] = await sampleGait(page.getByRole("img", { name: "Walking cat preview", exact: true }), 1200 / speed, [0.325]);
    const near = walk.feet.find(foot => foot.id === "front-near")!;
    const far = walk.feet.find(foot => foot.id === "front-far")!;
    expect(near.bottom).toBeCloseTo(78.5, 1);
    expect(far.bottom).toBeLessThan(near.bottom - 2);
    expect(timing.run.duration).toBeCloseTo(0.6 / speed);
    expect(timing.shadow.duration).toBeCloseTo(timing.run.duration);
    expect(timing.stretch.duration).toBeCloseTo(4.8 / speed);
    expect(timing.dream.duration).toBeCloseTo(4.8 / speed);
    expect(timing.dream.delay / timing.dream.duration).toBeCloseTo(-1 / 3);
  }
  await page.getByRole("radio", { name: "44 px", exact: true }).check();
  expect((await pose(page.locator(".pet-artwork").first())).width).toBeCloseTo(44);
  await expect(page.locator(".companion-catalogue")).toHaveAttribute("data-playing", "false");
  expect(await page.locator(".companion-catalogue").evaluate(element => element.getAnimations({ subtree: true }).every(animation => animation.playState === "paused"))).toBe(true);
});

test("reduced motion shows still poses and respects a user pause across preference changes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const catalogue = page.locator(".companion-catalogue");
  await expect(page.getByRole("status")).toHaveText("Reduced motion");
  await expect(page.getByRole("button", { name: "Play animations" })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Animation speed" })).toBeDisabled();
  await expect(catalogue).toHaveAttribute("data-playing", "false");
  expect(await catalogue.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(page.getByRole("img", { name: "Sleeping cat preview", exact: true }).locator(".pet-closed-eye")).toBeVisible();
  await expect(page.locator(".pet-dream").first()).toHaveCSS("opacity", "0");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.getByRole("button", { name: "Pause animations" })).toBeEnabled();
  await page.getByRole("button", { name: "Pause animations" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("button", { name: "Play animations" })).toBeDisabled();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.getByRole("button", { name: "Play animations" })).toBeEnabled();
  await expect(catalogue).toHaveAttribute("data-playing", "false");
});

test("playback and preview size remain keyboard accessible", async ({ page }) => {
  await page.getByRole("button", { name: "Pause animations" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Play animations" })).toBeFocused();
  await expect(page.locator(".companion-catalogue")).toHaveAttribute("data-playing", "false");
  const small = page.getByRole("radio", { name: "44 px", exact: true });
  await small.focus();
  await page.keyboard.press("Space");
  await expect(small).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "88 px", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "88 px", exact: true })).toBeFocused();
});

for (const width of [320, 390, 768]) {
  test(`keeps the artwork inside its stage at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: "Pause animations" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const time of [0, 324, 1008, 1632, 2400]) {
      await seek(page.getByRole("region", { name: "Cat animation catalogue" }), time);
      const clipped = await page.locator(".pet-artwork").evaluateAll(artworks => artworks.flatMap(artwork => {
        const stage = artwork.closest(".companion-catalogue-stage")!.getBoundingClientRect();
        return Array.from(artwork.querySelectorAll("path, ellipse, circle, text")).filter(part => {
          const bounds = part.getBoundingClientRect();
          return bounds.left < stage.left || bounds.right > stage.right || bounds.top < stage.top || bounds.bottom > stage.bottom;
        }).map(part => `${artwork.parentElement?.getAttribute("aria-label")}: ${part.getAttribute("class")}`);
      }));
      expect(clipped).toEqual([]);
    }
  });
}

for (const kind of ["teaching", "dashboard"] as const) {
  test(`${kind} chat uses all five poses without changing messages or the draft`, async ({ page }) => {
    const { pane, cat } = await mountChatPreview(page, { kind });
    await expect(cat).toHaveAttribute("data-cat-action", "sit");
    await pane.getByRole("textbox", { name: "Companion draft" }).fill("Keep this draft.");
    await updateChatPreview(page, { isSending: true });
    await expect(cat).toHaveAttribute("data-cat-action", "walk");
    await expect(pane.getByRole("status", { name: "Working on your request...", exact: true })).toHaveCount(1);
    await page.clock.fastForward(121000);
    await expect(cat).toHaveAttribute("data-cat-action", "walk");
    await updateChatPreview(page, { isTyping: true });
    await expect(cat).toHaveAttribute("data-cat-action", "run");
    await expect(pane.getByRole("status", { name: "Writing your response...", exact: true })).toHaveCount(1);
    await expect(pane.getByRole("status", { name: "Working on your request...", exact: true })).toHaveCount(0);
    await updateChatPreview(page, { isSending: false, isTyping: false });
    await expect(cat).toHaveAttribute("data-cat-action", "stretch");
    await expect(pane.getByRole("status")).toHaveCount(0);
    await page.clock.fastForward(4900);
    await expect(cat).toHaveAttribute("data-cat-action", "sit");
    await page.clock.fastForward(116100);
    await expect(cat).toHaveAttribute("data-cat-action", "sleep");
    await pane.getByRole("textbox", { name: "Companion draft" }).fill("Keep this draft. Continue.");
    await expect(cat).toHaveAttribute("data-cat-action", "sit");
    await expect(pane.getByText("Help me understand this lesson.", { exact: true })).toHaveCount(1);
    await expect(pane.getByText("Let's work through it together.", { exact: true })).toHaveCount(1);
    await expect(pane.getByRole("textbox", { name: "Companion draft" })).toHaveValue("Keep this draft. Continue.");
    await expect(pane.locator(".bounce-ball, .companion-atom")).toHaveCount(0);
    expect(await page.evaluate(() => Array.from(document.head.querySelectorAll("style"))
      .filter(style => style.textContent?.includes("@keyframes catalogue-cat-walk-front-near-upper")).length)).toBe(1);
    await page.evaluate(() => {
      if (!window.catChatPreview) throw new Error("Chat preview is not mounted");
      window.catChatPreview.dispose();
      delete window.catChatPreview;
    });
    await page.clock.fastForward(60000);
    await expect(pane).toHaveCount(0);
  });
}

test("chat preserves tool status, wakes on interaction, and resets between conversations", async ({ page }) => {
  const { pane, cat } = await mountChatPreview(page, { isSending: true, statusLabel: "Searching course materials..." });
  await expect(cat).toHaveAttribute("data-cat-action", "walk");
  await expect(pane.getByRole("status", { name: "Searching course materials\u2026", exact: true })).toBeVisible();
  await updateChatPreview(page, { isSending: false });
  await expect(cat).toHaveAttribute("data-cat-action", "stretch");
  await page.clock.fastForward(121000);
  await expect(cat).toHaveAttribute("data-cat-action", "sleep");
  await pane.getByRole("heading", { name: "Chat companion preview" }).click();
  await expect(cat).toHaveAttribute("data-cat-action", "sit");
  await page.clock.fastForward(121000);
  await expect(cat).toHaveAttribute("data-cat-action", "sleep");
  await updateChatPreview(page, { conversation: 2 });
  await expect(cat).toHaveAttribute("data-cat-action", "sit");
});

for (const kind of ["teaching", "dashboard"] as const) {
  test(`${kind} read-only and inactive companions stay still and reduced motion is respected`, async ({ page }) => {
    const { pane, cat } = await mountChatPreview(page, { kind, readOnly: true, isSending: true });
    await expect(cat).toHaveAttribute("data-cat-action", "sleep");
    await expect(cat).toHaveAttribute("data-playing", "false");
    expect(await cat.evaluate(element => element.getAnimations({ subtree: true }).every(animation => animation.playState === "paused"))).toBe(true);
    await expect(pane.getByRole("status")).toHaveCount(0);
    await updateChatPreview(page, { readOnly: false, active: false });
    await expect(cat).toHaveAttribute("data-playing", "false");
    await updateChatPreview(page, { active: true });
    await expect(cat).toHaveAttribute("data-cat-action", "walk");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await cat.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
    await updateChatPreview(page, { isTyping: true });
    await expect(cat).toHaveAttribute("data-cat-action", "run");
    expect(await cat.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
  });
}

test("the live chat-sized cat retains grounded walking and running", async ({ page }) => {
  const { cat } = await mountChatPreview(page, { isSending: true });
  await expect(cat).toHaveAttribute("data-cat-action", "walk");
  expect((await cat.boundingBox())!.width).toBe(56);
  const walking = await sampleGait(cat, 1200, Array.from({ length: 49 }, (_, index) => index / 48));
  for (const frame of walking) {
    expect(frame.feet.filter(foot => Math.abs(foot.bottom - 78.5) < 0.25).length).toBeGreaterThanOrEqual(2);
  }
  await updateChatPreview(page, { isTyping: true });
  await expect(cat).toHaveAttribute("data-cat-action", "run");
  const running = await sampleGait(cat, 600, [0, 0.1, 0.3, 0.4, 0.6, 0.82]);
  for (const frame of running) {
    for (const foot of frame.feet) expect(foot.bottom).toBeLessThanOrEqual(78.75);
    if (frame.progress < 0.64) expect(frame.feet.some(foot => Math.abs(foot.bottom - 78.5) < 0.25)).toBe(true);
  }
});

test("an empty chat uses one companion and handles an initial request without duplicate avatars", async ({ page }) => {
  const { pane, cat } = await mountChatPreview(page, { empty: true });
  await expect(cat).toHaveAttribute("data-cat-action", "sit");
  await expect(pane.locator(".lucide-bot")).toHaveCount(0);
  await updateChatPreview(page, { isSending: true });
  await expect(pane.locator(".cat-companion")).toHaveCount(1);
  await expect(cat).toHaveAttribute("data-cat-action", "walk");
  await expect(pane.getByRole("status", { name: "Working on your request...", exact: true })).toHaveCount(1);
});

for (const width of [1440, 390]) {
  test(`cat sits and sleeps on the first starter at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { pane, cat } = await mountChatPreview(page, { kind: "starters", empty: true });
    const starter = pane.getByRole("button", { name: "Why should I learn this course?", exact: true });
    for (const action of ["sit", "sleep"]) {
      if (action === "sleep") await page.clock.fastForward(121000);
      await expect(cat).toHaveAttribute("data-cat-action", action);
      const card = (await starter.boundingBox())!;
      const shadow = (await cat.locator(".pet-shadow").boundingBox())!;
      expect(Math.abs(shadow.y + shadow.height / 2 - card.y)).toBeLessThan(3);
      expect(shadow.x).toBeGreaterThan(card.x);
      expect(shadow.x + shadow.width).toBeLessThan(card.x + card.width);
      const bubble = (await pane.locator(".chat-companion-message").boundingBox())!;
      expect(bubble.y + bubble.height).toBeLessThan(card.y);
      expect(await pane.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await pane.screenshot({ path: testInfo.outputPath(`starter-cat-${action}-${width}.png`), animations: "disabled" });
    }
    await starter.click();
    await expect(pane.getByRole("textbox", { name: "Companion draft", exact: true })).toHaveValue("Why should I learn this course?");
    await expect(cat).toHaveAttribute("data-cat-action", "sit");
  });
}

test("the companion and long tool labels fit narrow chat panes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const { pane, cat } = await mountChatPreview(page, { isSending: true, statusLabel: "Reviewing the attached course materials and preparing the requested explanation" });
  await expect(cat).toHaveAttribute("data-cat-action", "walk");
  const overflow = await pane.evaluate(element => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
  const bounds = (await cat.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  await pane.screenshot({ path: testInfo.outputPath("chat-companion-mobile.png") });
});

for (const width of [1440, 320]) {
  test(`working companion bubble is compact and shimmers only its headline at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { pane } = await mountChatPreview(page, { isSending: true });
    const companion = pane.locator("[data-chat-companion]");
    const bubble = companion.locator(".chat-companion-message");
    const headline = companion.locator(".chat-companion-headline");
    const detail = companion.locator(".chat-companion-detail");
    await expect(headline).toHaveCSS("font-size", "13px");
    await expect(detail).toHaveCSS("font-size", "11px");
    await expect(bubble).toHaveCSS("padding", "7px 10px");
    await expect(bubble).toHaveCSS("border-radius", "12px");
    await expect(companion).toHaveCSS("gap", "10px");
    await expect(detail).toHaveCSS("margin-top", "2px");
    await expect(headline).toHaveCSS("animation-name", "text-shimmer");
    await expect(headline).toHaveCSS("animation-duration", "3s");
    await expect(detail).toHaveCSS("animation-name", "none");
    await expect(pane.getByRole("status", { name: "Working on your request...", exact: true })).toHaveCount(1);
    const sweep = await headline.evaluate(element => {
      const animation = element.getAnimations().find(item => item instanceof CSSAnimation && item.animationName === "text-shimmer");
      if (!animation) throw new Error("Working headline has no shimmer animation");
      animation.pause();
      animation.currentTime = 0;
      const start = getComputedStyle(element).backgroundPosition;
      animation.currentTime = 1500;
      const middle = getComputedStyle(element).backgroundPosition;
      animation.play();
      return { start, middle };
    });
    expect(sweep.start).not.toBe(sweep.middle);
    const bounds = (await bubble.boundingBox())!;
    if (width === 1440) {
      expect(bounds.height).toBeLessThanOrEqual(54);
      expect(bounds.width).toBeLessThanOrEqual(270);
    }
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await pane.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await companion.screenshot({ path: testInfo.outputPath(`compact-companion-${width}.png`), animations: "disabled" });
  });
}

test("companion headline shimmer stops for resting, waiting, reduced motion and forced colors", async ({ page }) => {
  const { pane } = await mountChatPreview(page, { isSending: true });
  const headline = pane.locator(".chat-companion-headline");
  for (const statusLabel of [null, "Planning", "Searching course materials", "Writing your response", "Creating slides", "Saving progress"]) {
    await updateChatPreview(page, { statusLabel });
    await expect(headline).toHaveCSS("animation-name", "text-shimmer");
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(headline).toHaveCSS("animation-name", "none");
  await expect(headline).toHaveCSS("background-image", "none");
  expect(await headline.evaluate(element => getComputedStyle(element).webkitTextFillColor === getComputedStyle(element).color)).toBe(true);
  await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "active" });
  await expect(headline).toHaveCSS("animation-name", "none");
  await expect(headline).toHaveCSS("background-image", "none");
  const forcedText = await headline.evaluate(element => {
    const style = getComputedStyle(element);
    return { fill: style.webkitTextFillColor, color: style.color };
  });
  expect(forcedText.fill).toBe(forcedText.color);
  await page.emulateMedia({ forcedColors: "none" });
  await expect(headline).toHaveCSS("animation-name", "text-shimmer");
  await updateChatPreview(page, { statusLabel: "Waiting for your response" });
  await expect(headline).toHaveCSS("animation-name", "none");
  await updateChatPreview(page, { isSending: false, statusLabel: null });
  await expect(headline).toHaveCSS("animation-name", "none");
  await expect(pane.locator(".animate-text-shimmer")).toHaveCount(0);
});

test("companion personalizes greetings and displays actual planning and clarification activity", async ({ page }) => {
  await page.evaluate(async () => {
    const modulePath = "/src/lib/chatStore.ts";
    const store: typeof import("./src/lib/chatStore") = await import(modulePath);
    store.useChatStore.setState({ userName: "Example Learner", userNickname: "Mira" });
  });
  const { pane } = await mountChatPreview(page, { empty: true });
  await expect(pane.getByText("Hi Mira! What would you like to learn today?", { exact: true })).toBeVisible();
  const bubble = pane.locator(".chat-companion-message");
  await expect(bubble).toHaveAttribute("data-bubble-variant", "speech");
  await expect(bubble).toHaveCSS("border-radius", "12px");
  expect(await bubble.evaluate(element => getComputedStyle(element, "::before").content)).toBe('""');
  expect(await bubble.evaluate(element => getComputedStyle(element, "::before").borderRadius)).toBe("0px");
  await updateChatPreview(page, { empty: false, isSending: true });
  await expect(pane.getByRole("status", { name: "Working on your request...", exact: true })).toBeVisible();
  await updateChatPreview(page, { toolActivity: "Planning" });
  await expect(pane.getByRole("status", { name: "Planning\u2026", exact: true })).toBeVisible();
  await updateChatPreview(page, { toolActivity: "Generating clarification questions" });
  await expect(pane.getByRole("status", { name: "Asking clarification questions\u2026", exact: true })).toBeVisible();
  await updateChatPreview(page, { toolActivity: null, isTyping: true });
  await expect(pane.getByRole("status", { name: "Writing your response...", exact: true })).toBeVisible();
  await updateChatPreview(page, { isSending: false, isTyping: false });
  await expect(pane.locator("[data-chat-companion]")).toHaveAttribute("data-companion-scene", "stretch");
  await page.clock.fastForward(5000);
  await expect(pane.locator("[data-chat-companion]")).toHaveAttribute("data-companion-scene", "ready");
});

test("clarification waiting alternates standing and stretching without continuing to walk", async ({ page }) => {
  const { pane, cat } = await mountChatPreview(page, { isSending: true, isTyping: true, statusLabel: "Waiting for your response" });
  const companion = pane.locator("[data-chat-companion]");
  await expect(companion).toHaveAttribute("data-companion-state", "stand");
  await expect(cat).toHaveAttribute("data-playing", "false");
  await expect(pane.getByRole("status", { name: "Waiting for your response\u2026", exact: true })).toBeVisible();
  await page.clock.fastForward(10100);
  await expect(companion).toHaveAttribute("data-companion-state", "stretch");
  await expect(cat).toHaveAttribute("data-playing", "true");
  await page.clock.fastForward(4900);
  await expect(companion).toHaveAttribute("data-companion-state", "stand");
  await expect(cat).toHaveAttribute("data-playing", "false");
  await page.clock.fastForward(10100);
  await expect(companion).toHaveAttribute("data-companion-state", "stretch");
  await updateChatPreview(page, { statusLabel: null });
  await expect(companion).toHaveAttribute("data-companion-state", "run");
  await expect(cat).toHaveAttribute("data-playing", "true");
  await page.clock.fastForward(20000);
  await expect(companion).toHaveAttribute("data-companion-state", "run");
});

test("the live tool label appears once without deleting the underlying activity", async ({ page }) => {
  const label = "Loading threshold concept progress";
  const { pane } = await mountChatPreview(page, { isSending: true, toolActivity: label });
  await expect(pane.getByText(`${label}\u2026`, { exact: true })).toHaveCount(1);
  await expect(pane.getByText("Let's work through it together.", { exact: true })).toBeVisible();
  await updateChatPreview(page, { active: false });
  await expect(pane.locator(".chat-companion-message")).toHaveCount(0);
  await expect(pane.getByText(`${label}\u2026`, { exact: true })).toHaveCount(1);
  await updateChatPreview(page, { active: true });
  await expect(pane.getByText(`${label}\u2026`, { exact: true })).toHaveCount(1);
});

test("asset tool activity runs the cat before any response text streams", async ({ page }) => {
  const { pane, cat } = await mountChatPreview(page, { isSending: true, isTyping: false });
  for (const label of ["Creating image", "Generating a document", "Generating a quiz", "Generating a challenge", "Creating slide deck", "Simulating circuit"]) {
    await updateChatPreview(page, { toolActivity: label });
    await expect(cat).toHaveAttribute("data-cat-action", "run");
    await expect(pane.getByText(`${label}\u2026`, { exact: true })).toHaveCount(1);
  }
  await page.clock.fastForward(121000);
  await expect(cat).toHaveAttribute("data-cat-action", "run");
});

test("current tool status preserves pending annotations in earlier turns", async ({ page }) => {
  await page.evaluate(async () => {
    const reactPath = "/node_modules/.vite/deps/react.js";
    const domPath = "/node_modules/.vite/deps/react-dom_client.js";
    const routerPath = "/node_modules/.vite/deps/react-router-dom.js";
    const panePath = "/src/features/chat/ChatPane.tsx";
    const { default: react }: { default: typeof import("react") } = await import(reactPath);
    const { default: dom }: { default: typeof import("react-dom/client") } = await import(domPath);
    const router: typeof import("react-router-dom") = await import(routerPath);
    const chat: typeof import("./src/features/chat/ChatPane") = await import(panePath);
    const host = document.createElement("div");
    host.dataset.testid = "companion-history-preview";
    host.style.cssText = "position:fixed;inset:0;z-index:10000;background:#171717;overflow:auto;";
    document.body.append(host);
    const activity = Object.freeze({
      type: "tool_activity" as const, activityId: "earlier-activity", label: "Loading course notes", done: false,
    });
    dom.createRoot(host).render(react.createElement(router.MemoryRouter, null,
      react.createElement(chat.default, {
        messages: [
          { role: "assistant", content: "The previous answer remains available.", contentBlocks: [activity] },
          { role: "user", content: "Continue with another question." },
        ],
        isSending: true, statusLabel: activity.label, disableAutoScroll: true,
      }),
    ));
  });
  const pane = page.getByTestId("companion-history-preview");
  await expect(pane.getByText("Loading course notes\u2026", { exact: true })).toHaveCount(2);
  await expect(pane.getByText("The previous answer remains available.", { exact: true })).toBeVisible();
  await expect(pane.getByText("Continue with another question.", { exact: true })).toBeVisible();
});

test("empty-chat sleep replaces the greeting and typing wakes it", async ({ page }) => {
  const { pane, cat } = await mountChatPreview(page, { empty: true });
  await expect(pane.locator(".chat-companion-message")).toHaveAttribute("data-bubble-variant", "speech");
  await page.clock.fastForward(120001);
  await expect(cat).toHaveAttribute("data-cat-action", "sleep");
  await expect(pane.locator(".chat-companion-message")).toHaveAttribute("data-bubble-variant", "thought");
  await expect(pane.locator(".chat-companion-message")).toHaveCSS("border-radius", "24px");
  await expect(pane.locator("[data-chat-companion]")).toHaveAttribute("data-companion-scene", "sleep");
  await expect(pane.locator(".chat-companion-message")).not.toContainText("What would you like to learn today");
  await pane.getByRole("textbox", { name: "Companion draft" }).fill("Another question");
  await expect(cat).toHaveAttribute("data-cat-action", "sit");
  await expect(pane.locator(".chat-companion-message")).toHaveAttribute("data-bubble-variant", "speech");
});

test("night sleep wakes for interaction and never interrupts asset generation", async ({ page }) => {
  await page.clock.setSystemTime(new Date(2026, 8, 29, 23));
  const { pane, cat } = await mountChatPreview(page, { empty: true });
  await expect(pane.locator("[data-chat-companion]")).toHaveAttribute("data-companion-scene", "night");
  await expect(cat).toHaveAttribute("data-cat-action", "sleep");
  await expect(pane.locator(".chat-companion-message")).toHaveAttribute("data-bubble-variant", "thought");
  await pane.getByRole("textbox", { name: "Companion draft" }).fill("A late question");
  await expect(cat).toHaveAttribute("data-cat-action", "sit");
  await page.clock.fastForward(60001);
  await expect(cat).toHaveAttribute("data-cat-action", "sleep");
  await updateChatPreview(page, { empty: false, isSending: true, toolActivity: "Creating image" });
  await expect(cat).toHaveAttribute("data-cat-action", "run");
  await expect(pane.locator(".chat-companion-message")).toHaveAttribute("data-bubble-variant", "speech");
});

test("bubble hints rotate without changing or reannouncing the tool label", async ({ page }) => {
  const { pane } = await mountChatPreview(page, { isSending: true, toolActivity: "Loading threshold concept progress" });
  const headline = pane.locator(".chat-companion-headline");
  const hint = pane.locator(".chat-companion-detail");
  const original = await hint.textContent();
  await page.clock.fastForward(20001);
  await expect(headline).toHaveText("Loading threshold concept progress\u2026");
  await expect(hint).not.toHaveText(original!);
  await expect(hint).toHaveAttribute("aria-live", "off");
});
