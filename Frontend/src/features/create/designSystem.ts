// features/create/designSystem.ts

export const KICKER = "text-xs text-neutral-500 mt-1";

export const PANEL = `
  rounded-2xl border border-white/[0.08] 
  bg-gradient-to-br from-white/[0.03] via-white/[0.01] to-transparent 
  backdrop-blur-xl shadow-2xl
  transition-all duration-300
  hover:border-white/[0.12]
`;

export const FIELD = `
  bg-black/30 border-white/10 text-neutral-100 
  placeholder:text-neutral-600 
  focus:ring-2 focus:ring-blue-500/30 
  focus:border-blue-500/50 
  transition-all duration-200 
  hover:border-white/20
  rounded-xl
`;

export const LABEL =
  "text-neutral-300 font-semibold text-sm tracking-wide";

export const BUTTON_PRIMARY = `
  bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600 
  hover:from-blue-400 hover:via-blue-500 hover:to-indigo-500 
  text-white shadow-xl shadow-blue-500/20
  border border-blue-400/30
  transition-all duration-300
  font-semibold
  hover:shadow-2xl hover:shadow-blue-500/30
  hover:scale-[1.02]
  active:scale-[0.98]
`;

export const BUTTON_SECONDARY = `
  bg-white/5 hover:bg-white/10 
  text-white border border-white/10 
  hover:border-white/20
  transition-all duration-300
  hover:scale-[1.02]
  active:scale-[0.98]
`;