"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lora } from "next/font/google";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
    CreditCard,
    LayoutDashboard,
    LogOut,
    Menu,
    X,
    Package,
    ReceiptText,
    Settings,
    Users,
} from "lucide-react";

const lora = Lora({
    subsets: ["latin"],
    weight: ["600", "700"],
});

interface SidebarProps {
    onOpenSettings?: () => void;
}

type AdminNavItem = {
    label: string;
    href: string;
    icon: LucideIcon;
    exact?: boolean;
};

function isCurrentPath(pathname: string, href: string, exact = false) {
    if (exact) {
        return pathname === href;
    }

    return pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({
                     item,
                     pathname,
                 }: {
    item: AdminNavItem;
    pathname: string;
}) {
    const Icon = item.icon;
    const active = isCurrentPath(pathname, item.href, item.exact);

    return (
        <Link
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[11px] font-medium leading-none transition-colors duration-150 ${
                active
                    ? "bg-[#5634BF] text-white shadow-[0_5px_12px_rgba(41,15,104,0.30)] hover:bg-[#633BCE]"
                    : "text-white/70 hover:bg-white/[0.09] hover:text-white"
            }`}
        >
            <Icon
                size={14}
                strokeWidth={active ? 2.2 : 1.85}
                className={`shrink-0 transition-colors duration-150 ${
                    active
                        ? "text-[#E8C15B] drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                        : "text-white/65 group-hover:text-[#E8C15B]"
                }`}
            />

            <span className="truncate">{item.label}</span>
        </Link>
    );
}

function SidebarSection({
                            label,
                            children,
                        }: {
    label: string;
    children: ReactNode;
}) {
    return (
        <section className="mt-3.5">
            <p className="mb-1.5 px-2.5 text-[8px] font-semibold uppercase tracking-[0.19em] text-white/40">
                {label}
            </p>

            <div className="space-y-0.5">{children}</div>
        </section>
    );
}

export default function PlatformAdminSidebar({ onOpenSettings }: SidebarProps) {
    const pathname = usePathname();
    const [logoFailed, setLogoFailed] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useEffect(() => {
        if (!mobileMenuOpen) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const onEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setMobileMenuOpen(false);
        };
        const desktopLayout = window.matchMedia("(min-width: 1024px)");
        const onDesktopResize = () => {
            if (desktopLayout.matches) setMobileMenuOpen(false);
        };
        window.addEventListener("keydown", onEscape);
        desktopLayout.addEventListener("change", onDesktopResize);
        return () => {
            document.body.style.overflow = previous;
            window.removeEventListener("keydown", onEscape);
            desktopLayout.removeEventListener("change", onDesktopResize);
        };
    }, [mobileMenuOpen]);

    function handleLogout() {
        const sessionKeys = [
            "token",
            "accessToken",
            "admin_token",
            "platform_admin_token",
            "user",
            "userData",
            "platformAdmin",
            "platform_admin",
            "role",
            "permissions",
            "profile",
            "stocknbook_user",
        ];

        sessionKeys.forEach((key) => {
            window.localStorage.removeItem(key);
            window.sessionStorage.removeItem(key);
        });

        window.location.replace("/");
    }

    const overviewItems: AdminNavItem[] = [
        {
            label: "Dashboard",
            href: "/platform-admin/dashboard",
            icon: LayoutDashboard,
            exact: true,
        },
    ];

    const managementItems: AdminNavItem[] = [
        { label: "Users", href: "/platform-admin/users", icon: Users },
        { label: "Plans", href: "/platform-admin/plans", icon: Package },
        { label: "Payments", href: "/platform-admin/payments", icon: CreditCard },
        {
            label: "Subscriptions",
            href: "/platform-admin/subscriptions",
            icon: ReceiptText,
        },
    ];

    return (
        <>
            <header className="fixed inset-x-0 top-0 z-[25] flex h-14 items-center gap-3 border-b border-[#422B64] bg-[#1E1035] px-3 text-white shadow-sm lg:hidden">
                <button
                    type="button"
                    aria-label="Open administrator navigation"
                    aria-expanded={mobileMenuOpen}
                    aria-controls="stocknbook-admin-navigation"
                    onClick={() => setMobileMenuOpen(true)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[#E8C15B]"
                >
                    <Menu size={21}/>
                </button>
                <span className="min-w-0 truncate text-sm font-bold">Stock<span className="text-[#E2A61A]">N</span>Book · Admin</span>
            </header>
            {mobileMenuOpen && (
                <button
                    type="button"
                    aria-label="Close administrator navigation"
                    onClick={() => setMobileMenuOpen(false)}
                    className="fixed inset-0 z-[30] bg-[#140B24]/65 lg:hidden"
                />
            )}
            <aside
                id="stocknbook-admin-navigation"
                data-stocknbook-admin-sidebar
                aria-label="Platform administrator navigation"
                className={`fixed inset-y-0 left-0 z-[35] flex max-h-dvh w-[min(85vw,280px)] shrink-0 flex-col overflow-y-auto bg-[#1E1035] font-sans text-white shadow-[2px_0_12px_rgba(19,8,44,0.10)] transition-transform duration-200 lg:static lg:z-auto lg:min-h-screen lg:max-h-none lg:w-[216px] lg:translate-x-0 lg:overflow-y-visible ${mobileMenuOpen ? "visible translate-x-0" : "invisible -translate-x-full lg:visible"}`}
            >
                <button
                    type="button"
                    aria-label="Close administrator navigation"
                    onClick={() => setMobileMenuOpen(false)}
                    className="absolute right-2 top-5 flex h-9 w-9 items-center justify-center rounded-md text-white/80 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[#E8C15B] lg:hidden"
                >
                    <X size={19}/>
                </button>
                {/* StockNBook logo */}
                <div className="border-b border-white/[0.08] px-4 py-4">
                    <Link
                        href="/platform-admin/dashboard"
                        className="flex items-center gap-3 rounded-lg outline-none transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-[#E8C15B]"
                    >
                        {logoFailed ? (
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#E2A61A] text-[13px] font-extrabold tracking-[-0.08em] text-[#241142]">
                                SN
                            </div>
                        ) : (
                            <Image
                                src="/logo.png"
                                alt="StockNBook logo"
                                width={48}
                                height={48}
                                priority
                                onError={() => setLogoFailed(true)}
                                className="h-12 w-12 shrink-0 rounded-xl object-contain"
                            />
                        )}

                        <span
                            className={`${lora.className} block min-w-0 truncate text-[18px] font-bold leading-none tracking-[-0.045em]`}
                        >
                        <span className="text-white">Stock</span>
                        <span className="text-[#E2A61A]">N</span>
                        <span className="text-white">Book</span>
                    </span>
                    </Link>
                </div>

                {/* Console identity */}
                <div className="border-b border-white/[0.08] px-4 py-4">
                    <div className="min-w-0">
                        <p className="w-full whitespace-normal break-words text-[15px] font-extrabold leading-snug tracking-[-0.02em] text-white [overflow-wrap:anywhere]">
                            Platform Admin
                        </p>

                        <p className="mt-1.5 w-full whitespace-normal break-words text-[11px] font-semibold leading-snug text-white [overflow-wrap:anywhere]">
                            System Console
                        </p>

                        <span className="mt-1.5 inline-flex rounded-md bg-[#B77D1B] px-2.5 py-0.5 text-[8px] font-semibold leading-none text-white shadow-sm">
                        Admin
                    </span>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="px-2.5 py-3" onClickCapture={() => setMobileMenuOpen(false)}>
                    <SidebarSection label="Overview">
                        {overviewItems.map((item) => (
                            <NavItem key={item.href} item={item} pathname={pathname} />
                        ))}
                    </SidebarSection>

                    <SidebarSection label="Management">
                        {managementItems.map((item) => (
                            <NavItem key={item.href} item={item} pathname={pathname} />
                        ))}
                    </SidebarSection>

                    {/* Settings and Logout */}
                    <SidebarSection label="System">
                        <button
                            type="button"
                            onClick={onOpenSettings}
                            className="group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[11px] font-medium leading-none text-white/70 transition-colors duration-150 hover:bg-white/[0.09] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8C15B]"
                        >
                            <Settings
                                size={14}
                                strokeWidth={1.85}
                                className="shrink-0 text-white/65 transition-colors duration-150 group-hover:text-[#E8C15B]"
                            />

                            <span>Settings</span>
                        </button>

                        <button
                            type="button"
                            onClick={handleLogout}
                            className="group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[11px] font-medium leading-none text-white/75 transition-colors duration-150 hover:bg-white/[0.09] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8C15B]"
                        >
                            <LogOut
                                size={14}
                                strokeWidth={1.85}
                                className="shrink-0 text-white/65 transition-colors duration-150 group-hover:text-[#E8C15B]"
                            />

                            <span>Logout</span>
                        </button>
                    </SidebarSection>
                </nav>
            </aside>
        </>
    );
}