// components/SendButton.tsx
import { Button } from "@/components/ui/button";
import { Send, Loader2 } from "lucide-react";

export function SendButton({
  loading, onClick, className = "", disabled,
}: { loading?: boolean; onClick?: () => void; className?: string; disabled?: boolean }) {
  return (
    <Button onClick={onClick} disabled={loading || disabled} className={className}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
    </Button>
  );
}
