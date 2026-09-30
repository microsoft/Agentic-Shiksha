(function () {
  "use strict";
  const motion = globalThis.ShikshaMotion;
  const exportKind = new URLSearchParams(location.search).get("export");
  if (exportKind) {
    if (!motion || !Object.hasOwn(motion.scenes, exportKind)) throw new Error("Unknown export scene");
    document.body.classList.add("export-mode");
    const stage = document.getElementById("export-stage");
    stage.hidden = false;
    globalThis.renderFrame = (time) => {
      stage.innerHTML = motion.render(exportKind, time);
      return motion.stageAt(motion.scenes[exportKind].stages, time);
    };
    globalThis.renderFrame(0);
    return;
  }

  const players = [];
  const videos = [...document.querySelectorAll("video")];
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  for (const root of document.querySelectorAll("[data-player]")) {
    const kind = root.dataset.player;
    if (!Object.hasOwn(motion.scenes, kind)) throw new Error(`Unknown player: ${kind}`);
    const spec = motion.scenes[kind];
    const viewport = root.querySelector(".viewport");
    const play = root.querySelector("[data-play]");
    const replay = root.querySelector("[data-replay]");
    const seek = root.querySelector("input[type=range]");
    const timeLabel = root.querySelector("[data-time]");
    const status = root.querySelector("[data-status]");
    let time = spec.poster;
    let playing = false;
    let frame = 0;
    let previous = 0;
    let stage = -1;
    seek.max = String(spec.duration - 0.01);

    function paint() {
      viewport.innerHTML = motion.render(kind, time);
      seek.value = String(time);
      seek.setAttribute("aria-valuetext", `${time.toFixed(1)} of ${spec.duration} seconds`);
      timeLabel.textContent = `${time.toFixed(1)} / ${spec.duration}s`;
      const current = motion.stageAt(spec.stages, time);
      if (current !== stage) {
        stage = current;
        status.textContent = `Step ${stage + 1}: ${spec.stages[stage].title}`;
      }
    }

    function stop() {
      playing = false;
      cancelAnimationFrame(frame);
      play.textContent = "Play";
      play.setAttribute("aria-pressed", "false");
    }

    function tick(now) {
      if (!playing) return;
      time = (time + (now - previous) / 1000) % spec.duration;
      previous = now;
      paint();
      frame = requestAnimationFrame(tick);
    }

    function start() {
      players.forEach((player) => player.stop());
      videos.forEach((video) => video.pause());
      playing = true;
      previous = performance.now();
      play.textContent = "Pause";
      play.setAttribute("aria-pressed", "true");
      frame = requestAnimationFrame(tick);
    }

    play.addEventListener("click", () => playing ? stop() : start());
    replay.addEventListener("click", () => { time = 0; paint(); start(); });
    seek.addEventListener("input", () => { stop(); time = Number(seek.value); paint(); });
    players.push({ stop });
    paint();
  }
  videos.forEach((video) => video.addEventListener("play", () => {
    players.forEach((player) => player.stop());
    videos.filter((other) => other !== video).forEach((other) => other.pause());
  }));
  function stopAll() {
    players.forEach((player) => player.stop());
    videos.forEach((video) => video.pause());
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAll();
  });
  reducedMotion.addEventListener("change", stopAll);
})();
