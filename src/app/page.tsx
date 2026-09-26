import { AuthPreview } from "@/components/preview/auth-preview";
import { registerWithToken, signInWithToken } from "@/features/auth/actions";

type HomePageProps = {
  searchParams: Promise<{ mode?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const { mode } = await searchParams;
  const view = mode === "signup" || mode === "reset" ? mode : "login";
  return (
    <AuthPreview
      actions={{ login: signInWithToken, signup: registerWithToken }}
      mode={view}
    />
  );
}
