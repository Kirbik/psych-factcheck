import { AuthPreview } from "@/components/preview/auth-preview";
import {
  generateRegistrationToken,
  registerWithToken,
  signInWithToken,
} from "@/features/auth/actions";
import { redirectAuthenticatedUser } from "@/features/auth/redirect-authenticated-user";

type AuthPageProps = {
  searchParams: Promise<{ mode?: string }>;
};

export default async function AuthPage({ searchParams }: AuthPageProps) {
  await redirectAuthenticatedUser();
  const { mode } = await searchParams;
  const view = mode === "signup" || mode === "reset" ? mode : "login";

  return (
    <AuthPreview
      actions={{
        generateToken: generateRegistrationToken,
        login: signInWithToken,
        signup: registerWithToken,
      }}
      mode={view}
    />
  );
}
