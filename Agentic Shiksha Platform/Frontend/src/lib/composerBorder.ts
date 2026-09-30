import { useCallback, useEffect, useState } from "react";

const HUE_STORAGE_KEY = "shiksha-composer-border-hue";
const SHADE_STORAGE_KEY = "shiksha-composer-border-shade";
const WIDTH_STORAGE_KEY = "shiksha-composer-border-width";
const COLOR_CSS_VAR = "--composer-border";
const WIDTH_CSS_VAR = "--composer-border-width";

/** Mid grey — the border colour used when neither a hue nor a shade is picked. */
export const DEFAULT_COMPOSER_BORDER = "hsl(0 0% 50%)";
/** Matches DEFAULT_COMPOSER_BORDER, so the shade slider starts where the default sits. */
export const DEFAULT_COMPOSER_BORDER_SHADE = 50;
export const DEFAULT_COMPOSER_BORDER_WIDTH = 0.05;
export const MIN_COMPOSER_BORDER_WIDTH = 0.05;
export const MAX_COMPOSER_BORDER_WIDTH = 8;
export const COMPOSER_BORDER_WIDTH_STEP = 0.05;

/** A shade is greyscale, so it carries no hue — the two settings are mutually exclusive. */
export function composerBorderColor(hue: number | null, shade: number | null): string {
  if (hue !== null) return `hsl(${hue} 70% 55%)`;
  if (shade !== null) return `hsl(0 0% ${shade}%)`;
  return DEFAULT_COMPOSER_BORDER;
}

export function formatComposerBorderWidth(width: number): string {
  // Range steps can land on values like 0.30000000000000004; round before showing.
  return `${Number(width.toFixed(2))}px`;
}

function readNumber(key: string, min: number, max: number): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= min && value <= max ? value : null;
  } catch {
    return null;
  }
}

function writeNumber(key: string, value: number | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch { /* ignore */ }
}

const readStoredHue = () => readNumber(HUE_STORAGE_KEY, 0, 360);
const readStoredShade = () => readNumber(SHADE_STORAGE_KEY, 0, 100);
const readStoredWidth = () =>
  readNumber(WIDTH_STORAGE_KEY, MIN_COMPOSER_BORDER_WIDTH, MAX_COMPOSER_BORDER_WIDTH);

export function applyComposerBorder(hue: number | null, shade: number | null) {
  document.documentElement.style.setProperty(COLOR_CSS_VAR, composerBorderColor(hue, shade));
}

export function applyComposerBorderWidth(width: number | null) {
  document.documentElement.style.setProperty(
    WIDTH_CSS_VAR,
    `${width ?? DEFAULT_COMPOSER_BORDER_WIDTH}px`,
  );
}

/** Applied once at startup so the saved colour is live before the composer paints. */
export function initComposerBorder() {
  applyComposerBorder(readStoredHue(), readStoredShade());
  applyComposerBorderWidth(readStoredWidth());
}

export function useComposerBorderColor() {
  const [hue, setHueState] = useState<number | null>(readStoredHue);
  const [shade, setShadeState] = useState<number | null>(readStoredShade);

  useEffect(() => {
    applyComposerBorder(hue, shade);
  }, [hue, shade]);

  const setHue = useCallback((next: number | null) => {
    setHueState(next);
    setShadeState(null);
    writeNumber(HUE_STORAGE_KEY, next);
    writeNumber(SHADE_STORAGE_KEY, null);
  }, []);

  const setShade = useCallback((next: number | null) => {
    setShadeState(next);
    setHueState(null);
    writeNumber(SHADE_STORAGE_KEY, next);
    writeNumber(HUE_STORAGE_KEY, null);
  }, []);

  const reset = useCallback(() => {
    setHueState(null);
    setShadeState(null);
    writeNumber(HUE_STORAGE_KEY, null);
    writeNumber(SHADE_STORAGE_KEY, null);
  }, []);

  return { hue, shade, setHue, setShade, reset };
}

export function useComposerBorderWidth() {
  const [width, setWidthState] = useState<number | null>(readStoredWidth);

  useEffect(() => {
    applyComposerBorderWidth(width);
  }, [width]);

  const setWidth = useCallback((next: number | null) => {
    setWidthState(next);
    writeNumber(WIDTH_STORAGE_KEY, next);
  }, []);

  return { width, setWidth };
}
