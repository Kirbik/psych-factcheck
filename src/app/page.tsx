import { AuthPreview } from "@/components/preview/auth-preview";
import { signIn, signUp } from "@/features/auth/actions";

type HomePageProps = {
  searchParams: Promise<{ mode?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const { mode } = await searchParams;
  const view = mode === "signup" || mode === "reset" ? mode : "login";
  const actions = { login: signIn, signup: signUp };

  return <AuthPreview actions={actions} mode={view} />;
}
