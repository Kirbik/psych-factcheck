import { AuthPreview } from "@/components/preview/auth-preview";
import { signIn, signUp } from "@/features/auth/actions";

type AuthPreviewPageProps = {
  searchParams: Promise<{ mode?: string }>;
};

export default async function AuthPreviewPage({
  searchParams,
}: AuthPreviewPageProps) {
  const { mode } = await searchParams;
  const view = mode === "signup" || mode === "reset" ? mode : "login";
  const action = view === "signup" ? signUp : view === "login" ? signIn : undefined;

  return <AuthPreview action={action} mode={view} />;
}
