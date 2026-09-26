import { redirect } from "next/navigation";

type AuthPreviewPageProps = {
  searchParams: Promise<{ mode?: string }>;
};

export default async function AuthPreviewPage({
  searchParams,
}: AuthPreviewPageProps) {
  const { mode } = await searchParams;
  const query = mode === "signup" || mode === "reset" ? `?mode=${mode}` : "";
  redirect(`/auth${query}`);
}
