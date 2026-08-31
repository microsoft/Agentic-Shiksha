// src/lib/chatApi.ts
// Minimal chat API service — only user profile ops needed by dashboard auth.

import { DASHBOARD_API_URL } from "./config";

const API_BASE = DASHBOARD_API_URL;

export interface UserProfileAffiliation {
  institute: string;
  department: string;
  role: string;
}

export interface UserProfile {
  id: string;
  userId: string;
  fullName: string;
  displayName: string;
  nickname: string;
  email: string;
  department: string;
  college: string;
  workFunction: string;
  preferences: string;
  customInstructions: string;
  learningProfile: string;
  authProvider: string;
  language: string;
  currentLocation: string;
  interests: string;
  passionateAbout: string;
  onboardingCompleted: boolean;
  role?: string;
  status?: "invited" | "active";
  affiliations?: UserProfileAffiliation[];
  activeAffiliation?: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfileUpdate {
  fullName?: string;
  displayName?: string;
  nickname?: string;
  email?: string;
  department?: string;
  college?: string;
  workFunction?: string;
  preferences?: string;
  customInstructions?: string;
  learningProfile?: string;
  authProvider?: string;
  language?: string;
  currentLocation?: string;
  interests?: string;
  passionateAbout?: string;
  onboardingCompleted?: boolean;
}

class ChatApiService {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`API ${response.status}: ${body}`);
    }
    return response.json();
  }

  async getUserProfile(userId: string): Promise<{ success: boolean; profile: UserProfile | null }> {
    if (!userId) return { success: false, profile: null };
    return this.fetch<{ success: boolean; profile: UserProfile | null }>(`/api/user/${userId}`);
  }

  async updateUserProfile(userId: string, profile: UserProfileUpdate): Promise<{ success: boolean; profile: UserProfile }> {
    if (!userId) throw new Error("userId is required");
    return this.fetch<{ success: boolean; profile: UserProfile }>(`/api/user/${userId}`, {
      method: "PUT",
      body: JSON.stringify(profile),
    });
  }
}

export const chatApi = new ChatApiService();
