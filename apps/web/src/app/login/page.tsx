import { Suspense } from "react";

import { LoginForm } from "@/components/login-form";
import { Shell } from "@/components/shell";

export default function LoginPage() {
  return (
    <Shell>
      <h1 className="text-2xl font-semibold">Logowanie</h1>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </Shell>
  );
}
