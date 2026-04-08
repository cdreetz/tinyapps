"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Header() {
  const pathname = usePathname();

  const links = [
    { href: "/", label: "Vim" },
    { href: "/sheets", label: "Sheets" },
  ];

  return (
    <header className="flex items-center gap-6 px-4 py-2 border-b border-neutral-800 bg-neutral-950 text-sm">
      <span className="font-semibold text-white tracking-tight">tinyapps</span>
      <nav className="flex gap-4">
        {links.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={
              pathname === href
                ? "text-white"
                : "text-neutral-400 hover:text-white transition-colors"
            }
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
