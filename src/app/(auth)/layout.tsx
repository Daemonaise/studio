import Link from "next/link";
import { Logo } from "@/components/icons";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-secondary/50">
      <div className="container flex w-full max-w-md flex-col items-center justify-center gap-6">
        <Link href="/" className="flex items-center gap-2 text-foreground">
          <Logo className="h-8 w-8" />
          <span className="text-xl font-bold">Karasawa Heavy Industries</span>
        </Link>
        {children}
      </div>
    </div>
  );
}
