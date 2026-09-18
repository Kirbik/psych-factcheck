import { AuthPreview } from "@/components/preview/auth-preview";

type AuthPreviewPageProps = {
  searchParams: Promise<{ mode?: string }>;
};

export default async function AuthPreviewPage({
  searchParams,
}: AuthPreviewPageProps) {
  const { mode } = await searchParams;
  const view = mode === "signup" || mode === "reset" ? mode : "login";

  return <AuthPreview mode={view} />;
}
