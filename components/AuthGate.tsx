"use client";

import LoginModal from "@/components/LoginModal";
import { useAuth } from "@/contexts/AuthContext";
import PreferencesBridge from "@/components/PreferencesBridge";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();

  if (loading) {
    return (
      <div
        className="relative flex h-full min-h-0 items-center justify-center overflow-hidden bg-[#1a1816]"
        aria-busy="true"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-[#252220]/45 via-[#1a1816] to-[#1a1816]"
        />
        <div
          aria-hidden="true"
          className="relative h-16 w-16 drop-shadow-[0_0_14px_rgba(249,200,109,0.2)]"
        >
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-b-[#a18d6f] border-l-transparent border-r-[#c0a480] border-t-[#f9c86d]" />
          <div className="absolute inset-2 animate-spin rounded-full border-2 border-b-[#c0a480] border-l-transparent border-r-[#f9c86d] border-t-[#a18d6f] [animation-direction:reverse] [animation-duration:1.4s]" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginModal />;
  }

  return (
    <PreferencesBridge key={user.id}>
      {children}
    </PreferencesBridge>
  );
}
