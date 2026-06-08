"use client";

import Link from "next/link";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

type Role = "owner" | "manager" | "staff";

// Helper for persistent sidebar nav links with active page highlighting
function SidebarNavLink({
                            href,
                            children,
                        }: {
    href: string;
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const active = pathname === href;

    return (
        <Link
            href={href}
            className={
                `block rounded-lg px-3 py-2 text-[11px] transition 
        hover:bg-white/10 hover:text-white active:bg-white/20 ` +
                (active
                    ? "bg-white/10 text-white font-semibold"
                    : "text-white/45")
            }
            aria-current={active ? "page" : undefined}
        >
            {children}
        </Link>
    );
}

function getSavedItem(key: string) {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem(key) || localStorage.getItem(key) || "";
}

function formatPersonName(name: string) {
    return name
        .trim()
        .toLowerCase()
        .split(" ")
        .filter(Boolean)
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

export default function RoleSidebar() {
    const { user, loading } = useCurrentUser();

    // ---- Hydration-fix: only render after mount
    const [mounted, setMounted] = useState(false);

    // Persistent state for collapsed/expanded sidebar
    const [collapsed, setCollapsed] = useState(true);

    useEffect(() => {
        setMounted(true);
        const stored = localStorage.getItem("sidebar-collapsed");
        setCollapsed(stored !== "false");
    }, []);

    const toggleSidebar = () => {
        setCollapsed((prev) => {
            if (typeof window !== "undefined") {
                localStorage.setItem("sidebar-collapsed", (!prev).toString());
            }
            return !prev;
        });
    };

    const role = (user?.role || "owner") as Role;
    const permissions = user?.permissions || {};

    const storeName =
        user?.store_name || getSavedItem("store_name") || "StockNBook";
    const branchName = user?.branch_name || getSavedItem("branch_name") || "";

    const ownerName =
        user?.owner_name ||
        getSavedItem("owner_name") ||
        getSavedItem("name") ||
        storeName ||
        "Owner";

    const managerName =
        user?.manager_name || getSavedItem("manager_name") || "Manager";

    const staffName =
        user?.staff_name || getSavedItem("staff_name") || "Staff";

    const rawPersonName =
        role === "owner"
            ? ownerName
            : role === "manager"
                ? managerName
                : staffName;

    const personName = formatPersonName(rawPersonName);

    const subLabel =
        role === "owner"
            ? storeName
            : branchName || storeName || "Branch";

    const roleLabel =
        role === "owner"
            ? "Owner"
            : role === "manager"
                ? "Manager"
                : "Staff";

    const canAccess = (permission: string) => {
        if (role === "owner") return true;
        return permissions[permission] === true;
    };

    const showAnalytics = () => {
        if (role === "owner" || role === "manager") return true;
        return !!permissions.analytics;
    };

    const handleLogout = () => {
        if (typeof window === "undefined") return;
        sessionStorage.clear();
        localStorage.clear();
        window.location.href = "/";
    };

    // --- HYDRATION FIX ---
    if (!mounted) return null;

    // While loading user, can show the collapsed version
    if (loading) {
        return (
            <aside
                style={{
                    backgroundColor: "#1E1035",
                    fontFamily: "Georgia, 'Times New Roman', serif",
                }}
                className={`flex min-h-screen w-[68px] flex-col justify-between overflow-hidden text-white transition-all duration-200`}
            >
                <div className="px-[14px] py-4">
                    <div
                        style={{ backgroundColor: "#C9951A" }}
                        className="h-[26px] w-[26px] rounded-[7px]"
                    />
                </div>
            </aside>
        );
    }

    if (!user) return null;

    return (
        <aside
            style={{
                backgroundColor: "#1E1035",
                fontFamily: "Georgia, 'Times New Roman', serif",
            }}
            className={`flex min-h-screen ${
                collapsed ? "w-[68px]" : "w-[196px]"
            } flex-col justify-between overflow-hidden text-white transition-all duration-200`}
        >
            <div>
                {/* Logo: clickable, toggles collapse */}
                <div
                    className="border-b border-white/[0.06] px-[14px] py-4 cursor-pointer select-none"
                    onClick={toggleSidebar}
                    title="Toggle sidebar"
                >
                    <div className="flex items-center gap-2">
                        <div
                            style={{ backgroundColor: "#C9951A" }}
                            className="h-[26px] w-[26px] rounded-[7px]"
                        />
                        {!collapsed && (
                            <h1
                                className="text-[13px] font-semibold text-white"
                                style={{ transition: "opacity 0.15s" }}
                            >
                                StockNBook
                            </h1>
                        )}
                    </div>
                </div>
                {/* Navigation only shown when not collapsed */}
                {!collapsed && (
                    <div>
                        <div className="border-b border-white/[0.06] px-[14px] py-4">
                            <div className="flex items-center gap-3">
                                <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[#4B2D78] text-[12px] font-semibold text-white">
                                    {personName
                                        .split(" ")
                                        .map((n) => n[0])
                                        .join("")
                                        .toUpperCase()
                                        .slice(0, 2) || "U"}
                                </div>
                                <div className="min-w-0">
                                    <p className="truncate text-[11px] font-medium text-white">
                                        {personName}
                                    </p>
                                    <span
                                        style={{ backgroundColor: "#5A372E" }}
                                        className="mt-1 inline-block rounded-md px-3 py-1 text-[8px] font-medium text-white"
                                    >
                    {roleLabel}
                  </span>
                                    <p className="mt-1 truncate text-[9px] font-semibold text-white/35">
                                        {subLabel}
                                    </p>
                                </div>
                            </div>
                        </div>
                        <nav className="mt-3 px-2 pb-4">
                            {/* Overview */}
                            <p className="mb-1 px-2 text-[9px] uppercase tracking-[0.15em] text-white/30">
                                Overview
                            </p>
                            <div className="space-y-0.2">
                                <SidebarNavLink href="/dashboard">Dashboard</SidebarNavLink>
                                {role === "owner" && (
                                    <SidebarNavLink href="/branches">Branches</SidebarNavLink>
                                )}
                            </div>
                            {(canAccess("bookings") ||
                                canAccess("inventory") ||
                                canAccess("packages") ||
                                canAccess("pos")) && (
                                <>
                                    <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/30">
                                        Business
                                    </p>
                                    <div className="space-y-0.2">
                                        {canAccess("bookings") && (
                                            <SidebarNavLink href="/bookings">Bookings</SidebarNavLink>
                                        )}
                                        {canAccess("inventory") && (
                                            <SidebarNavLink href="/inventory">Inventory</SidebarNavLink>
                                        )}
                                        {canAccess("packages") && (
                                            <SidebarNavLink href="/packages">Packages</SidebarNavLink>
                                        )}
                                        {canAccess("pos") && (
                                            <SidebarNavLink href="/pos">Sales / POS</SidebarNavLink>
                                        )}
                                    </div>
                                </>
                            )}
                            {(showAnalytics() || canAccess("reports")) && (
                                <>
                                    <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/30">
                                        Analytics
                                    </p>
                                    <div className="space-y-0.2">
                                        {showAnalytics() && (
                                            <SidebarNavLink href="/analytics">Analytics</SidebarNavLink>
                                        )}
                                        {canAccess("reports") && (
                                            <SidebarNavLink href="/reports">Reports</SidebarNavLink>
                                        )}
                                        {(role === "owner" || role === "manager") && (
                                            <SidebarNavLink href="/forecasting">Forecasting</SidebarNavLink>
                                        )}
                                    </div>
                                </>
                            )}
                            {(role === "owner" ||
                                (role === "manager" && canAccess("staff_management"))) && (
                                <>
                                    <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/30">
                                        Team
                                    </p>
                                    <div className="space-y-0.2">
                                        {role === "owner" && (
                                            <SidebarNavLink href="/branch-managers">Branch Managers</SidebarNavLink>
                                        )}
                                        {role === "manager" && canAccess("staff_management") && (
                                            <SidebarNavLink href="/manager/staff-management">Staff</SidebarNavLink>
                                        )}
                                    </div>
                                </>
                            )}
                            {(role === "owner" || canAccess("branch_settings")) && (
                                <>
                                    <p className="mb-1 mt-3 px-2 text-[9px] uppercase tracking-[0.15em] text-white/30">
                                        System
                                    </p>
                                    <div className="space-y-1">
                                        <SidebarNavLink href="/settings">Settings</SidebarNavLink>
                                    </div>
                                </>
                            )}
                        </nav>
                    </div>
                )}
            </div>
            {!collapsed && (
                <div className="px-2 pb-3">
                    <button
                        onClick={handleLogout}
                        className="block w-full rounded-lg px-3 py-2 text-left text-xs text-white/90 hover:bg-white/10 active:bg-white/20"
                    >
                        Logout
                    </button>
                </div>
            )}
        </aside>
    );
}

