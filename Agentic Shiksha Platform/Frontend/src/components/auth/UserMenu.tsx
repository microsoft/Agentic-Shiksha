// src/components/auth/UserMenu.tsx
// User menu component showing profile and logout option

import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/useAuth";
import { useChatStore } from "@/lib/chatStore";
import { SignInButton } from "./SignInButton";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { User, LogOut, Settings } from "lucide-react";

interface UserMenuProps {
  className?: string;
}

export function UserMenu({ className = "" }: UserMenuProps) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { userName, userFullName } = useChatStore();
  const navigate = useNavigate();

  // If not authenticated, show sign in button
  if (!isAuthenticated) {
    return <SignInButton className={className} />;
  }

  // Get display info
  const displayName = userFullName || userName || user?.displayName || "User";
  const email = user?.email || "";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={`flex items-center gap-2 px-2 ${className}`}
        >
          {/* Avatar with initials */}
          <div className="h-8 w-8 rounded-full bg-neutral-700 border border-neutral-600 flex items-center justify-center text-neutral-200 text-sm font-medium">
            {initials}
          </div>
          <span className="hidden sm:inline text-sm font-medium truncate max-w-[120px]">
            {displayName}
          </span>
        </Button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent align="end" className="w-56">
        {/* User info */}
        <div className="px-2 py-2">
          <p className="text-sm font-medium">{displayName}</p>
          {email && (
            <p className="text-xs text-neutral-500 truncate">{email}</p>
          )}
        </div>
        
        <DropdownMenuSeparator />
        
        {/* Menu items */}
        <DropdownMenuItem className="cursor-pointer">
          <User className="mr-2 h-4 w-4" />
          Profile
        </DropdownMenuItem>
        
        <DropdownMenuItem className="cursor-pointer">
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        
        <DropdownMenuSeparator />
        
        <DropdownMenuItem
          className="cursor-pointer text-red-600 focus:text-red-600"
          onClick={() => navigate("/signout")}
          disabled={isLoading}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
