"use client";
import { PasswordLoginCard } from "@/components/password-login-card";

export function LoginForm({ next }: { next?: string }) {
  return (
    <PasswordLoginCard
      variant="admin"
      endpoint="/api/admin/login"
      defaultNext="/admin"
      next={next}
    />
  );
}
