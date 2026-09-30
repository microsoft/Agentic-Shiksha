// src/components/auth/SignInButton.tsx
// Microsoft Sign In button component

import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

// Microsoft logo SVG
const MicrosoftLogo = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="21"
    height="21"
    viewBox="0 0 21 21"
    className="mr-2"
  >
    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
  </svg>
);

interface SignInButtonProps {
  useRedirect?: boolean;
  className?: string;
  variant?: "default" | "outline" | "ghost";
}

export function SignInButton({ 
  useRedirect = false, 
  className = "",
  variant = "outline"
}: SignInButtonProps) {
  const { loginWithPopup, loginWithRedirect, isLoading, isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return null; // Don't show sign in button if already authenticated
  }

  const handleSignIn = async () => {
    if (useRedirect) {
      await loginWithRedirect();
    } else {
      await loginWithPopup();
    }
  };

  return (
    <Button
      onClick={handleSignIn}
      disabled={isLoading}
      variant={variant}
      className={`flex items-center gap-2 ${className}`}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <MicrosoftLogo />
      )}
      Sign in with Microsoft
    </Button>
  );
}
