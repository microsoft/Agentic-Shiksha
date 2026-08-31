import React from "react";
import type { AzureAgentRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { WHITE_BTN } from "@/lib/config";

export function AgentRow({
  ag,
  onChat,
  onDelete,
}: {
  ag: AzureAgentRow;
  onChat: () => void;
  onDelete: () => Promise<void>;
}) {
  return (
    <div className="grid grid-cols-12 items-center gap-2 py-3">
      <div className="col-span-8">
        <div className="font-medium">{ag.name || "(unnamed agent)"}</div>
        <div className="text-xs text-muted-foreground">
          Model: <code>{ag.model || ""}</code>
          {ag.status ? <> · Status: {ag.status}</> : null}
        </div>
        {ag.description && <div className="text-xs text-muted-foreground">{ag.description}</div>}
      </div>

      <div className="col-span-2 flex justify-end">
        <Button variant="secondary" className={WHITE_BTN} onClick={onChat}>
          Chat
        </Button>
      </div>

      <div className="col-span-2 flex justify-end">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="icon" className="border-zinc-300">
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{ag.name || "this agent"}”?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove the agent from Azure AI Foundry. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={onDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}