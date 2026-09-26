import { AuthPreview } from "@/components/preview/auth-preview";
import {
  generateRegistrationToken,
  registerWithToken,
  signInWithToken,
} from "@/features/auth/actions";

type HomePageProps = {
  searchParams: Promise<{ mode?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
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
