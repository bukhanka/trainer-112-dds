import { requireUser } from "@/lib/auth/session";

// Full-screen workstation, styled after the customer's system; no cabinet frame.
export default async function WorkstationLayout({ children }: LayoutProps<"/dds">) {
  await requireUser(["STUDENT", "TEACHER", "ADMIN"]);
  return <div className="flex min-h-screen flex-col">{children}</div>;
}
