"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function PageTransition() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    setActive(true);
    const t = setTimeout(() => setActive(false), 700);
    return () => clearTimeout(t);
  }, [pathname]);

  if (!active) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[9998] h-[2px] overflow-hidden pointer-events-none">
      <div className="kl-page-sweep h-full" />
    </div>
  );
}
