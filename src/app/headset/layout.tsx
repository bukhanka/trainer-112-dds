import { requireUser } from "@/lib/auth/session";

export default async function HeadsetLayout({ children }: LayoutProps<"/headset">) {
  await requireUser();
  return <div className="flex min-h-screen flex-col bg-arm-panel">{children}</div>;
}
