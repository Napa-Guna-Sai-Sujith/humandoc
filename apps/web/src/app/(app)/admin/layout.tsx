import { AdminRoleGate } from "@/components/admin-role-gate";
import { getSession } from "@/lib/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return <AdminRoleGate initialRole={session?.user.role ?? null}>{children}</AdminRoleGate>;
}
