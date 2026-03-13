"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { Menu, LogOut } from "lucide-react";
import { Logo } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/theater", label: "😊" },
  { href: "/automotive", label: "Automotive" },
  { href: "/materials", label: "Materials" },
  { href: "/karaslice", label: "Karaslice ✨" },
];

export function Header() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const isLoggedIn = hydrated && !!session?.user;

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center">
        <div className="mr-4 hidden md:flex">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <Logo className="h-6 w-6" />
            <span className="hidden font-bold sm:inline-block">
              Karasawa Labs
            </span>
          </Link>
          <nav className="flex items-center space-x-6 text-sm font-medium">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "transition-colors hover:text-foreground/80",
                  (pathname === item.href || (item.href.startsWith("/#") && pathname === "/"))
                    ? "text-foreground"
                    : "text-foreground/60"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 md:hidden"
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle Menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="pr-0">
            <Link href="/" className="mr-6 flex items-center space-x-2" onClick={() => setMobileOpen(false)}>
              <Logo className="h-6 w-6" />
              <span className="font-bold">Karasawa Labs</span>
            </Link>
            <div className="my-4 h-[calc(100vh-8rem)] pb-10 pl-6">
              <div className="flex flex-col space-y-3">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "transition-colors hover:text-foreground/80",
                      (pathname === item.href || (item.href.startsWith("/#") && pathname === "/"))
                        ? "text-foreground"
                        : "text-foreground/60"
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
                {isLoggedIn && (
                  <>
                    <Link
                      href="/portal"
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "transition-colors hover:text-foreground/80",
                        pathname === "/portal" ? "text-foreground" : "text-foreground/60"
                      )}
                    >
                      My Portal
                    </Link>
                    <button
                      onClick={() => { setMobileOpen(false); signOut({ callbackUrl: "/" }); }}
                      className="text-left text-foreground/60 transition-colors hover:text-foreground/80"
                    >
                      Sign Out
                    </button>
                  </>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex flex-1 items-center justify-end space-x-2">
          <nav className="flex items-center space-x-2">
            {isLoggedIn ? (
              <div className="flex items-center gap-2">
                {session.user?.image && (
                  <img
                    src={session.user.image}
                    alt=""
                    className="h-7 w-7 rounded-full border border-border"
                    referrerPolicy="no-referrer"
                  />
                )}
                <Button asChild variant="ghost">
                  <Link href="/portal">
                    {session.user?.name?.split(" ")[0] ?? "Portal"}
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => signOut({ callbackUrl: "/" })}
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button asChild variant="ghost">
                <Link href="/login">Sign In</Link>
              </Button>
            )}
            <Button asChild style={{ backgroundColor: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}>
              <Link href="/quote">Start Quote</Link>
            </Button>
          </nav>
        </div>
      </div>
    </header>
  );
}
