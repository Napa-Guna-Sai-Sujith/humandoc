import { AppAuthGate } from "@/components/app-auth-gate";
import { getSession } from "@/lib/session";

export const metadata = { title: "Dashboard" };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const initialUser = session
    ? { id: session.user.id, name: session.user.name, email: session.user.email, role: session.user.role }
    : null;

  return <AppAuthGate initialUser={initialUser}>{children}</AppAuthGate>;
}
