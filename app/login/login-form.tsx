"use client";
import { PasswordLoginCard } from "@/components/password-login-card";

export function LoginForm({ next }: { next?: string }) {
  return (
    <PasswordLoginCard
      variant="household"
      endpoint="/api/household/login"
      defaultNext="/"
      next={next}
    />
  );
}
