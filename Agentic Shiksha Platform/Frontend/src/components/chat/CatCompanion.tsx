import { useEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import clsx from "clsx";
import { CAT_LEG_JOINTS, createCatGaitKeyframes, type CatGait } from "./companionCatGaits";
import {
  COMPANION_MESSAGE_MS, getCompanionMessage, resolveCompanionState, resolveCompanionBubbleVariant,
  type CatAction, type CompanionBubbleVariant, type CompanionState,
} from "./chatCompanionState";
import "./CatCompanion.css";

export type { CatAction, CompanionBubbleVariant } from "./chatCompanionState";

const CAT_POSES: Record<CatAction, { label: string; blinkOffset: number }> = {
  sit: { label: "Sitting cat", blinkOffset: 0 },
  walk: { label: "Walking cat", blinkOffset: 0.47 },
  run: { label: "Running cat", blinkOffset: 0.94 },
  stretch: { label: "Stretching cat", blinkOffset: 1.41 },
  sleep: { label: "Sleeping cat", blinkOffset: 1.88 },
};
const CAT_GAIT_KEYFRAMES = createCatGaitKeyframes();
const CAT_FOREHEAD_MARKINGS = "M39 24 L42 30 L45 24 M47 24 L49 29 L52 25";

function CatEyes({ profile = false, sleeping = false }: { profile?: boolean; sleeping?: boolean }) {
  const positions = profile ? [64] : [34, 53];
  if (sleeping) return <>{positions.map(x => (
    <path key={x} className="pet-closed-eye" d={`M${x - 3} 40 Q${x} 43 ${x + 3} 39`} />
  ))}</>;
  return (
    <g className="pet-eye pet-cat-eyes" data-motion="blink">
      {positions.map(x => <g key={x}>
        <ellipse className="pet-eye-dot" cx={x} cy="39" rx="2.8" ry="3.7" />
        <circle className="pet-eye-shine" cx={x + 0.8} cy="37.8" r="0.9" />
      </g>)}
    </g>
  );
}

function CatLeg({ position, depth, gait }: { position: "front" | "back"; depth: "near" | "far"; gait?: CatGait }) {
  const front = position === "front";
  const { hip, knee, ankle } = CAT_LEG_JOINTS[position];
  const motion = gait ? `catalogue-cat-${gait}-${position}-${depth}` : undefined;
  const variables = {
    "--cat-hip-origin": `${hip.x}px ${hip.y}px`,
    "--cat-knee-origin": `${knee.x}px ${knee.y}px`,
    "--cat-paw-origin": `${ankle.x}px ${ankle.y}px`,
    ...(motion ? {
      "--cat-upper-animation": `${motion}-upper`,
      "--cat-lower-animation": `${motion}-lower`,
      "--cat-paw-animation": `${motion}-paw`,
    } : {}),
  } as CSSProperties;
  return (
    <g className={`pet-cat-leg pet-cat-leg-${position} pet-cat-leg-${depth}`} data-motion="leg" style={variables}>
      <path className={`pet-cat-upper-leg${!front && depth === "near" ? " pet-soft-shade" : ""}`} d={front
        ? "M51 56 Q55 53 59 57 L59 66 Q58 70 53 68 Q51 66 51 63Z"
        : "M26 52 C19 52 17 57 20 63 L24 68 Q28 70 31 66 C34 61 33 53 26 52Z"} />
      <g className="pet-cat-shin" data-motion="shin">
        <path className="pet-cat-shank" d={front
          ? "M53 65 Q56 63 59 66 L58 73.5 Q56 76 53 74.5Z"
          : "M25 64 Q28 63 30 66 L27 73.5 Q25 76 22.5 74.5 L23 70Z"} />
        <g className="pet-cat-paw-motion" data-motion="paw">
          <path className="pet-cat-foot" d={front
            ? "M53 73.2 Q56 72.3 58.5 74 L58.2 75 Q61.5 74.8 62 77 Q62 78.5 59 78.5 H55 Q52 78.5 52.5 75Z"
            : "M22 73.2 Q25 72.3 27.5 74 L27.2 75 Q30.5 74.8 31 77 Q31 78.5 28 78.5 H24 Q21 78.5 21.5 75Z"} />
        </g>
      </g>
    </g>
  );
}

function CatArtwork({ action }: { action: CatAction }) {
  if (action === "sit") return <>
    <g className="pet-cat-tail" data-motion="tail">
      <path className="pet-tail-stroke" d="M55 72 C68 76 75 68 73 59" />
      <path className="pet-tail-stroke pet-cat-tail-tip" data-motion="tail-tip" d="M73 59 Q71 50 76 45" />
    </g>
    <g className="pet-cat-body" data-motion="torso">
      <path className="pet-fur" d="M29 48 Q43 39 58 48 L64 68 Q68 78 55 78 H32 Q19 78 23 68Z" />
      <ellipse className="pet-soft-shade" cx="29" cy="69" rx="8" ry="8" />
      <ellipse className="pet-soft-shade" cx="57" cy="69" rx="8" ry="8" />
      <path className="pet-highlight" d="M35 53 Q43 57 52 53 L50 69 Q43 76 37 68Z" />
    </g>
    <path className="pet-cat-paw" d="M34 60 L33 73 Q33 78 38 78 Q42 78 42 74 L42 62 M47 62 L47 74 Q47 78 52 78 Q56 78 55 73 L54 60" />
    <g className="pet-cat-head" data-motion="head">
      <g className="pet-cat-ear pet-cat-ear-left" data-motion="ear">
        <path className="pet-fur" d="M23 32 L20 12 Q31 15 36 27Z" />
        <path className="pet-inner-ear" d="M25 27 L24 19 L31 27Z" />
      </g>
      <g className="pet-cat-ear pet-cat-ear-right" data-motion="ear">
        <path className="pet-fur" d="M52 27 Q57 15 66 12 L64 33Z" />
        <path className="pet-inner-ear" d="M57 27 L62 19 L61 29Z" />
      </g>
      <path className="pet-fur pet-cat-face" d="M22 33 C22 19 64 19 64 34 C68 48 58 58 43 58 C28 58 19 48 22 33Z" />
      <path className="pet-soft-shade pet-cat-forehead-markings" d={CAT_FOREHEAD_MARKINGS} />
      <CatEyes />
      <ellipse className="pet-blush" cx="29" cy="46" rx="3.5" ry="1.6" />
      <ellipse className="pet-blush" cx="58" cy="46" rx="3.5" ry="1.6" />
      <path className="pet-highlight" d="M36 47 Q38 42 43 45 Q49 42 51 47 Q49 53 43 50 Q37 53 36 47Z" />
      <path className="pet-nose" d="M40 44 Q43 42 46 44 L43 47Z" />
      <path className="pet-line" d="M43 47 V49 M39 49 Q41 52 43 49 Q45 52 47 49 M20 44 L29 46 M20 49 L29 48 M58 46 L67 44 M58 48 L67 49" />
    </g>
  </>;

  const sleeping = action === "sleep";
  const running = action === "run";
  const gait = action === "walk" || action === "run" ? action : undefined;
  return <>
    {!sleeping && <>
      <CatLeg position="back" depth="far" gait={gait} />
      <CatLeg position="front" depth="far" gait={gait} />
      <g className="pet-cat-tail" data-motion="tail">
        <path className="pet-tail-stroke" d={running ? "M25 60 Q13 65 8 54" : "M25 59 C12 59 4 47 7 35"} />
        <path className="pet-tail-stroke pet-cat-tail-tip" data-motion="tail-tip" d={running ? "M8 54 Q5 49 7 45" : "M7 35 Q8 28 12 30"} />
      </g>
    </>}
    <g className="pet-cat-body" data-motion="torso">
      <path className="pet-fur pet-cat-silhouette" d={sleeping
        ? "M15 66 C15 46 48 45 58 58 Q69 61 69 73 Q63 79 41 78 H28 Q14 77 15 66Z"
        : "M18 55 C21 47 29 45 37 48 C44 49 48 48 53 48 C62 48 65 55 63 62 C62 70 54 72 46 70 C39 69 35 70 29 70 C20 71 15 65 18 55Z"} />
      {sleeping
        ? <path className="pet-soft-shade" d="M23 61 Q29 54 36 60 Q43 68 34 74 Q21 77 21 69" />
        : <path className="pet-highlight" d="M49 52 Q55 56 60 52 L57 66 Q54 70 51 66Z" />}
    </g>
    {!sleeping && <>
      <CatLeg position="back" depth="near" gait={gait} />
      <CatLeg position="front" depth="near" gait={gait} />
    </>}
    {sleeping && <path className="pet-tail-stroke pet-cat-sleep-tail" d="M16 63 C8 76 32 82 52 75" />}
    <g className="pet-cat-head" data-motion="head">
      <g className="pet-cat-ear pet-cat-ear-left" data-motion="ear">
        <path className="pet-soft-shade" d="M41 34 L37 15 Q48 19 51 28Z" />
        <path className="pet-inner-ear" d="M41 22 L46 28 L42 29Z" />
      </g>
      <g className="pet-cat-ear pet-cat-ear-right" data-motion="ear">
        <path className="pet-fur" d="M55 28 Q56 16 63 12 Q69 21 68 33Z" />
        <path className="pet-inner-ear" d="M59 25 L62 18 L65 27Z" />
      </g>
      <path className="pet-fur pet-cat-face" d="M39 40 C39 29 47 22 58 23 C69 23 75 30 75 40 Q77 43 77 47 C76 54 67 60 58 59 C47 59 39 51 39 40Z" />
      <path className="pet-soft-shade pet-cat-forehead-markings" d={CAT_FOREHEAD_MARKINGS} transform="translate(13 0)" />
      <CatEyes profile sleeping={sleeping} />
      <ellipse className="pet-blush" cx="56.5" cy="46" rx="3.5" ry="1.6" />
      <path className="pet-highlight" d="M62 47 Q64 43 68 45 Q72 43 75 46 Q77 49 73 52 Q69 54 65 51 Q62 52 62 47Z" />
      <path className="pet-nose" d="M71 44 Q73 43 75 44 L73 47Z" />
      <path className="pet-line" d="M73 47 V49 M68 49 Q70 52 73 49 M55 44 L63 46 M55 49 L63 48 M74 46 L80 44 M74 48 L80 49" />
    </g>
  </>;
}

export function CatCompanion({ action, size = 44, speed = 1, playing = true, decorative = false, label, className }: {
  action: CatAction;
  size?: number;
  speed?: number;
  playing?: boolean;
  decorative?: boolean;
  label?: string;
  className?: string;
}) {
  const variables = {
    width: size, height: size,
    "--catalogue-duration": `${4.8 / speed}s`,
    "--pet-duration": `${2.4 / speed}s`,
    "--pet-detail-duration": `${1.2 / speed}s`,
    "--pet-wag-duration": `${0.6 / speed}s`,
    "--pet-blink-delay": `${-CAT_POSES[action].blinkOffset / speed}s`,
  } as CSSProperties;
  return (
    <span className={clsx("cat-companion", className)} data-cat-action={action} data-pet="cat" data-playing={playing}
      style={variables} role={decorative ? undefined : "img"} aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label || CAT_POSES[action].label}>
      <style href="cat-companion-gaits" precedence="components">{CAT_GAIT_KEYFRAMES}</style>
      <svg key={action} className="pet-artwork" viewBox="0 0 88 88" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <ellipse className="pet-shadow" cx="43" cy="80" rx="24" ry="3" data-motion="shadow" />
        <g className="pet-puppet" data-motion="body"><CatArtwork action={action} /></g>
        {action === "sleep" && <g className="pet-dreams">
          {[0, 1, 2].map(dream => <text key={dream} className="pet-dream" x="65" y="48" data-motion="dream">z</text>)}
        </g>}
      </svg>
    </span>
  );
}

export function ChatCompanionBubble({
  state, userName, messageIndex = 0, size = 56, showStatus = true,
  bubbleVariant, className, rootRef,
}: {
  state: CompanionState;
  userName?: string;
  messageIndex?: number;
  size?: number;
  showStatus?: boolean;
  bubbleVariant?: CompanionBubbleVariant;
  className?: string;
  rootRef?: Ref<HTMLSpanElement>;
}) {
  const message = getCompanionMessage(state, userName, messageIndex);
  const variant = resolveCompanionBubbleVariant(state.action, bubbleVariant);
  return (
    <span ref={rootRef} data-chat-companion data-companion-state={state.standing ? "stand" : state.action}
      data-companion-scene={state.scene} className={clsx("chat-companion", className)}>
      <CatCompanion key={state.scene === "waiting" ? `waiting-${state.standing}` : state.action}
        action={state.action} size={size} playing={state.scene !== "inactive" && !state.standing} decorative />
      {showStatus && message.headline && (
        <span className="chat-companion-message" data-bubble-variant={variant}>
          <span role={message.announce ? "status" : undefined} aria-label={message.announce ? message.headline : undefined}
            aria-atomic={message.announce || undefined}
            className={clsx("chat-companion-headline", state.working && "animate-text-shimmer")}>{message.headline}</span>
          {message.detail && <span className="chat-companion-detail" aria-live="off">{message.detail}</span>}
        </span>
      )}
    </span>
  );
}

export function ChatCompanion({
  isSending = false, isTyping = false, statusLabel, activityKey = "", contextKey = "",
  active = true, readOnly = false, size = 56, showStatus = true, userName, empty = false,
  bubbleVariant, className,
}: {
  isSending?: boolean;
  isTyping?: boolean;
  statusLabel?: string | null;
  activityKey?: string;
  contextKey?: string;
  active?: boolean;
  readOnly?: boolean;
  size?: number;
  showStatus?: boolean;
  userName?: string;
  empty?: boolean;
  bubbleVariant?: CompanionBubbleVariant;
  className?: string;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const wasWorking = useRef(false);
  const previousContext = useRef(contextKey);
  const previousActivity = useRef(activityKey);
  const workContext = useRef(contextKey);
  const [now, setNow] = useState(() => Date.now());
  const [openedAt, setOpenedAt] = useState(now);
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);
  const [completedAt, setCompletedAt] = useState<number | null>(null);
  const state = resolveCompanionState({
    now, openedAt, lastActivityAt, completedAt, isSending, isTyping, statusLabel,
    activityKey, active, readOnly, empty,
  });

  useEffect(() => {
    if (!active || readOnly) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, readOnly]);

  useEffect(() => {
    if (workContext.current === contextKey && wasWorking.current && !state.working && active && !readOnly) {
      const time = Date.now();
      setCompletedAt(time);
      setLastActivityAt(time);
      setNow(time);
    }
    workContext.current = contextKey;
    wasWorking.current = state.working;
  }, [state.working, active, readOnly, contextKey]);

  useEffect(() => {
    const wake = () => {
      const time = Date.now();
      setLastActivityAt(time);
      setCompletedAt(null);
      setNow(time);
    };
    if (previousContext.current !== contextKey) {
      const time = Date.now();
      setOpenedAt(time);
      setNow(time);
      setCompletedAt(null);
      setLastActivityAt(null);
      if (active && !readOnly) wake();
    } else if (previousActivity.current !== activityKey && active && !readOnly) {
      wake();
    }
    previousContext.current = contextKey;
    previousActivity.current = activityKey;
    if (!active || readOnly) return;
    const surface = root.current?.closest("[data-chat-companion-surface]") ?? root.current?.parentElement;
    for (const event of ["pointerdown", "keydown", "focusin"]) surface?.addEventListener(event, wake, true);
    return () => {
      for (const event of ["pointerdown", "keydown", "focusin"]) surface?.removeEventListener(event, wake, true);
    };
  }, [active, activityKey, contextKey, readOnly]);

  const rotationMs = state.action === "sleep" ? COMPANION_MESSAGE_MS * 2 : COMPANION_MESSAGE_MS;
  return (
    <ChatCompanionBubble rootRef={root} state={state} userName={userName}
      messageIndex={Math.floor(Math.max(0, now - openedAt) / rotationMs)}
      size={size} showStatus={showStatus} bubbleVariant={bubbleVariant} className={className} />
  );
}
