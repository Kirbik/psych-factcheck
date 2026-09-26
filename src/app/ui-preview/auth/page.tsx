import { AuthPreview } from "@/components/preview/auth-preview";
import {
  generateRegistrationToken,
  registerWithToken,
  signInWithToken,
} from "@/features/auth/actions";

type AuthPreviewPageProps = {
  searchParams: Promise<{ mode?: string }>;
};

export default async function AuthPreviewPage({
  searchParams,
}: AuthPreviewPageProps) {
  const { mode } = await searchParams;
  const view = mode === "signup" || mode === "reset" ? mode : "login";
  return (
    <AuthPreview
      actions={{
        login: signInWithToken,
        generateToken: generateRegistrationToken,
        signup: registerWithToken,
      }}
      mode={view}
    />
  );
}
