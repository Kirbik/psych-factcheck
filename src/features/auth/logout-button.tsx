"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/features/auth/actions";

export function LogoutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      loading={pending}
      onClick={() => startTransition(() => void signOut())}
      type="button"
    >
      {pending ? "Выходим…" : "Выйти"}
    </Button>
  );
}
