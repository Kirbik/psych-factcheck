import { AuthPreview } from "@/components/preview/auth-preview";

type HomePageProps = {
  searchParams: Promise<{ mode?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const { mode } = await searchParams;
  const view = mode === "login" || mode === "reset" ? mode : "signup";

  return <AuthPreview mode={view} />;
}
