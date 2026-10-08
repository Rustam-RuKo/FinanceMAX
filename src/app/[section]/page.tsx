import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticate } from "../../server/auth";
import Workspace from "../../components/Workspace";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const token = (await cookies()).get("financemax_session")?.value;
  const user = await authenticate(token).catch(() => null);
  if (!user) redirect("/login");
  const { section } = await params;
  return <Workspace user={user} section={section} />;
}
