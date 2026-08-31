// src/components/auth/LoginPage.tsx
// Full-page login screen shown before accessing the app

import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/useAuth";
import { Loader2 } from "lucide-react";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { continueWithMicrosoft, continueWithGoogle, isLoading, isAuthenticated, isMsalAuthenticated, error, clearError, retryAuth } = useAuth();

  // Pick up error from URL (set by backend auth callback on failure)
  const urlError = searchParams.get("error");

  // Redirect to home if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      console.log("[LoginPage] User is authenticated, redirecting to /home");
      navigate("/home", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Show loading while checking auth status or during login
  if (isLoading) {
    return (
      <div className="fixed inset-0 min-h-screen w-screen bg-neutral-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-neutral-400 text-sm">Connecting...</p>
        </div>
      </div>
    );
  }

  const displayError = error || (urlError ? decodeURIComponent(urlError.replace(/\+/g, " ")) : null);

  const handleContinue = () => {
    clearError();
    continueWithMicrosoft();
  };

  const handleGoogleContinue = () => {
    clearError();
    continueWithGoogle();
  };

  return (
    <div className="fixed inset-0 min-h-screen w-screen bg-neutral-900 flex flex-col items-center justify-center p-4 z-50">

      {/* Login card */}
      <div className="relative z-10 w-full max-w-[23rem]">
        {/* Single unified card */}
        <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl px-10 py-7 shadow-lg shadow-black/20">
          {/* Logo and title */}
          <div className="text-center mb-4">
            <h1 className="text-4xl font-semibold text-white tracking-tight mb-1">Shiksha</h1>
            <p className="text-base text-neutral-400">Your Learning Companion</p>
          </div>

          {/* Divider */}
          <div className="border-t border-neutral-700/50 my-4"></div>

          {/* Description */}
          <p className="text-neutral-400 text-center text-sm mb-4 leading-relaxed">
            Unlock a smarter way to access personalized, interactive learning.
          </p>

          {/* Error message */}
          {displayError && (
            <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-red-400 text-sm text-center">{displayError}</p>
            </div>
          )}

          {/* Microsoft sign-in button */}
          <button
            onClick={handleContinue}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-5 h-12 bg-neutral-800 hover:bg-neutral-700 text-white font-medium text-base rounded-lg transition-colors duration-200 border border-neutral-700 shadow-md shadow-black/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Connecting...</span>
              </>
            ) : (
              <>
                {/* Microsoft Logo */}
                <svg className="w-5 h-5" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                  <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                  <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                  <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                  <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                </svg>
                <span>Continue with Microsoft</span>
              </>
            )}
          </button>

          {/* Divider with "or" */}
          <div className="flex items-center gap-3 my-3">
            <div className="flex-1 border-t border-neutral-700/50"></div>
            <span className="text-neutral-400 text-sm">or</span>
            <div className="flex-1 border-t border-neutral-700/50"></div>
          </div>

          {/* Google sign-in button */}
          <button
            onClick={handleGoogleContinue}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-5 h-12 bg-neutral-800 hover:bg-neutral-700 text-white font-medium text-base rounded-lg transition-colors duration-200 border border-neutral-700 shadow-md shadow-black/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Connecting...</span>
              </>
            ) : (
              <>
                {/* Google Logo */}
                <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11.96 11.96 0 0 0 1 12c0 1.94.46 3.78 1.18 5.43l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span>Continue with Google</span>
              </>
            )}
          </button>

          <p className="text-neutral-400 text-sm text-center mt-4 leading-relaxed">
            By continuing, you agree to our{" "}
            <a 
              href="http://go.microsoft.com/fwlink/?LinkId=518021" 
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-400 hover:text-white transition-colors"
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a 
              href="https://go.microsoft.com/fwlink/?LinkId=521839" 
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-400 hover:text-white transition-colors"
            >
              Privacy Policy
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
