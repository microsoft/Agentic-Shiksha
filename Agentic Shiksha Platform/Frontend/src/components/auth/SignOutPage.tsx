// src/components/auth/SignOutPage.tsx
// Handles user sign out - clears session and redirects to auth page

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/useAuth";
import { Loader2 } from "lucide-react";

export function SignOutPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const handleSignOut = async () => {
      try {
        await logout();
      } catch (error) {
        console.error("Sign out error:", error);
      }
      // Redirect to auth page after sign out
      navigate("/auth", { replace: true });
    };

    handleSignOut();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 min-h-screen w-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 flex flex-col items-center justify-center p-4 z-50">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <p className="text-neutral-400 text-sm">Signing out...</p>
      </div>
    </div>
  );
}
