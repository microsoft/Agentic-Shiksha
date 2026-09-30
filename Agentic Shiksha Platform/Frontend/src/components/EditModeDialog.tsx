import React from "react";
import {
  AlertDialog,
  AlertDialogContent,
} from "@/components/ui/alert-dialog";
import { Settings2, FileEdit, Workflow, ArrowRight, X } from "lucide-react";

type EditMode = "simplistic" | "advanced";

type EditModeDialogProps = {
  open: boolean;
  onClose: () => void;
  onSelectMode: (mode: EditMode) => void;
};

export function EditModeDialog({
  open,
  onClose,
  onSelectMode,
}: EditModeDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <AlertDialogContent className="max-w-4xl bg-gradient-to-br from-neutral-950 via-black to-neutral-950 border border-white/10">
        {/* Animated background effects */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-lg">
          <div className="absolute top-0 -left-1/4 w-1/2 h-1/2 bg-purple-500/5 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-0 -right-1/4 w-1/2 h-1/2 bg-blue-500/5 rounded-full blur-3xl animate-pulse delay-1000" />
        </div>

        <div className="relative px-6 py-8">
          {/* Close button at top-right */}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-lg
              text-neutral-400 hover:text-white
              hover:bg-white/10
              bg-transparent border-0
              transition-all duration-200
              z-10"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Header */}
          <div className="text-center mb-10">
            <div className="inline-flex p-2.5 rounded-2xl bg-gradient-to-br from-purple-500/10 to-blue-600/10 border border-purple-500/20 mb-5 shadow-2xl shadow-purple-500/5 backdrop-blur-sm">
              <Settings2 className="h-7 w-7 text-purple-400" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-3 bg-gradient-to-r from-purple-200 via-white to-blue-200 bg-clip-text text-transparent tracking-tight">
              Select Edit Mode
            </h1>
            <p className="text-neutral-400 text-base">
              Choose how you want to edit this agent
            </p>
          </div>

          {/* Mode Cards */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Simplistic Mode */}
            <button
              type="button"
              onClick={() => onSelectMode("simplistic")}
              className="group relative text-left rounded-2xl bg-white/[0.03] backdrop-blur-xl border border-white/10 w-full p-7
                hover:shadow-2xl hover:shadow-purple-500/30 hover:scale-[1.02] hover:border-purple-500/60
                transition-all duration-500 ease-out overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 to-pink-600/0 group-hover:from-purple-500/5 group-hover:to-pink-600/5 transition-all duration-500 rounded-2xl" />
              <div className="relative">
                <div className="flex items-start justify-between mb-5">
                  <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-600/20 border border-purple-400/40 group-hover:border-purple-300/60 transition-all duration-300 group-hover:scale-110 group-hover:rotate-3">
                    <FileEdit className="h-7 w-7 text-purple-200 group-hover:text-purple-100 transition-colors" />
                  </div>
                  <ArrowRight className="h-5 w-5 text-purple-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-2 transition-all duration-500" />
                </div>

                <h2 className="text-2xl font-bold text-white mb-3 group-hover:text-purple-100 transition-colors">
                  Simplistic Mode
                </h2>

                <p className="text-neutral-300 text-sm leading-relaxed group-hover:text-neutral-200 transition-colors">
                  Edit course information and knowledge base files only
                </p>
              </div>
            </button>

            {/* Advanced Mode */}
            <button
              type="button"
              onClick={() => onSelectMode("advanced")}
              className="group relative text-left rounded-2xl bg-white/[0.03] backdrop-blur-xl border border-white/10 w-full p-7
                hover:shadow-2xl hover:shadow-blue-500/30 hover:scale-[1.02] hover:border-blue-500/60
                transition-all duration-500 ease-out overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 to-cyan-600/0 group-hover:from-blue-500/5 group-hover:to-cyan-600/5 transition-all duration-500 rounded-2xl" />
              <div className="relative">
                <div className="flex items-start justify-between mb-5">
                  <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-600/20 border border-blue-400/40 group-hover:border-blue-300/60 transition-all duration-300 group-hover:scale-110 group-hover:rotate-3">
                    <Workflow className="h-7 w-7 text-blue-200 group-hover:text-blue-100 transition-colors" />
                  </div>
                  <ArrowRight className="h-5 w-5 text-blue-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-2 transition-all duration-500" />
                </div>

                <h2 className="text-2xl font-bold text-white mb-3 group-hover:text-blue-100 transition-colors">
                  Advanced Mode
                </h2>

                <p className="text-neutral-300 text-sm leading-relaxed group-hover:text-neutral-200 transition-colors">
                  Full access to Setup, Builder chat, and Configuration
                </p>
              </div>
            </button>
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
