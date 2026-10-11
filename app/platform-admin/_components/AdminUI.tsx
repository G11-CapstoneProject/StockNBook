"use client";

// ---------------------------------------------------------------------------
// Shared design system for /platform-admin/*
//
// Every color, radius, and font size below was copied directly from
// app/platform-admin/dashboard/page.tsx so that Users, Packages, Payments,
// and Subscriptions render as one consistent product instead of four
// separately-styled screens. If the dashboard's palette changes, update it
// here once and every screen that imports from this file follows.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";
import { X } from "lucide-react";

// ---------------------------------------------------------------------------
// Color tokens (lifted verbatim from the dashboard)
// ---------------------------------------------------------------------------

export const colors = {
    pageBg: "#FFFDF8",
    textPrimary: "#1A1220",
    textHeading: "#24152F",
    textRowTitle: "#30243A",
    textLabel: "#4B3E55",
    textSubtle: "#7A6A84",
    textMuted: "#8A7D92",
    textMutedHover: "#806A8C",
    border: "#E6DDF0",
    divider: "#EEE8F2",
    headerBorder: "#E9E0EF",
    surfaceTint: "#FAF8FF",
    purple: "#6D35D4",
    purpleSoft: "#F1EBFF",
    purpleDark: "#2B174C",
    purpleDarkHover: "#1B0D31",
    green: "#16834A",
    greenSoft: "#E6F7EE",
    gold: "#A56607",
    goldSoft: "#FFF8E8",
    red: "#C32F2F",
    redSoft: "#FFF0F0",
} as const;

// ---------------------------------------------------------------------------
// Page shell — header + scroll section, matching the dashboard's layout
// ---------------------------------------------------------------------------

export function AdminPageShell({ children }: { children: ReactNode }) {
    return <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">{children}</div>;
}

export function AdminHeader({
                                title,
                                subtitle,
                                action,
                            }: {
    title: string;
    subtitle: string;
    action?: ReactNode;
}) {
    return (
        <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
            <div className="flex min-h-[88px] min-w-0 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
                <div className="min-w-0">
                    <h1 className="break-words text-xl font-bold tracking-[-0.02em] text-[#1A1220] sm:text-[25px]">{title}</h1>
                    <p className="mt-1 text-[12px] leading-5 text-[#7A6A84]">{subtitle}</p>
                </div>
                {action}
            </div>
        </header>
    );
}

export function AdminSection({ children }: { children: ReactNode }) {
    return (
        <section className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4 font-sans sm:px-6 sm:py-5">
            <div className="mx-auto max-w-none space-y-3.5">{children}</div>
        </section>
    );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
    return (
        <div className={`rounded-[16px] border border-[#E6DDF0] bg-white p-5 shadow-sm ${className}`}>
            {children}
        </div>
    );
}

export function CardHeader({
                               title,
                               subtitle,
                               action,
                           }: {
    title: string;
    subtitle?: string;
    action?: ReactNode;
}) {
    return (
        <div className="flex items-center justify-between gap-3 border-b border-[#EEE8F2] pb-4">
            <div className="min-w-0">
                <h2 className="truncate text-[18px] font-bold leading-6 text-[#24152F]">{title}</h2>
                {subtitle && <p className="mt-0.5 truncate text-[9px] leading-5 text-[#8A7D92]">{subtitle}</p>}
            </div>
            {action}
        </div>
    );
}

export function ViewAllButton({ onClick }: { onClick?: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="shrink-0 rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] px-4 py-2 text-[10px] font-semibold text-[#6D35D4] transition hover:bg-[#F3EEFF]"
        >
            View all
        </button>
    );
}

// A small stat tile, matching the "Active Stores / Total Subscriptions" row
export function KpiTile({
                            label,
                            value,
                            icon,
                            tintBg,
                            tintText,
                        }: {
    label: string;
    value: string | number;
    icon: ReactNode;
    tintBg: string;
    tintText: string;
}) {
    return (
        <div className="flex min-h-[124px] items-center gap-3 rounded-[16px] border border-[#E6DDF0] bg-white px-4 py-5 shadow-sm">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${tintBg} ${tintText}`}>
        {icon}
      </span>
            <div className="min-w-0 flex-1">
                <p className="break-words text-[12px] font-semibold leading-4 text-[#4B3E55]">{label}</p>
                <p className={`mt-1 text-[25px] font-bold leading-none ${tintText}`}>{value}</p>
            </div>
        </div>
    );
}

// The larger KPI card with a trend pill, matching the top row of the dashboard
export function TopKpiCard({
                               title,
                               value,
                               trend,
                               icon,
                               iconClass,
                           }: {
    title: string;
    value: string | number;
    trend?: string;
    icon: ReactNode;
    iconClass: string;
}) {
    return (
        <article className="flex min-h-[128px] items-center gap-5 rounded-[16px] border border-[#E6DDF0] bg-white px-5 py-5 shadow-sm">
      <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
        {icon}
      </span>
            <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold leading-5 text-[#4B3E55]">{title}</p>
                <p className="mt-2 truncate text-[26px] font-bold leading-none tracking-[-0.03em] text-[#1A1220]">
                    {value}
                </p>
                {trend && (
                    <div className="mt-2 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-[#E6F7EE] px-2 py-0.5 text-[11px] font-bold text-[#16834A]">
              {trend}
            </span>
                        <span className="text-[11px] text-[#8A7D92]">vs last period</span>
                    </div>
                )}
            </div>
        </article>
    );
}

// ---------------------------------------------------------------------------
// Rows — the "avatar + name/email + right-side content" pattern used for
// both Payment Verification and Renewal Watch on the dashboard
// ---------------------------------------------------------------------------

export function AvatarBadge({
                                initials,
                                bg,
                                text,
                            }: {
    initials: string;
    bg: string;
    text: string;
}) {
    return (
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${bg} ${text} text-xs font-bold`}>
      {initials}
    </span>
    );
}

export function ListRow({ children }: { children: ReactNode }) {
    return (
        <div className="flex items-center justify-between rounded-xl border border-[#E6DDF0] p-3 transition hover:bg-[#FAF8FF]">
            {children}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Badges / pills
// ---------------------------------------------------------------------------

type Plan = "Starter" | "Business" | "Enterprise";

export function PlanBadge({ plan }: { plan: Plan }) {
    const badgeStyle =
        plan === "Starter"
            ? "border-[#B7E5C2] bg-[#E6F6EA] text-[#226B36]"
            : plan === "Business"
                ? "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]"
                : "border-[#D8C5F3] bg-[#F1EBFF] text-[#6D35D4]";

    return (
        <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold ${badgeStyle}`}>
      {plan}
    </span>
    );
}

type PillTone = "green" | "gold" | "purple" | "red" | "neutral";

const PILL_TONE_STYLE: Record<PillTone, string> = {
    green: "bg-[#E6F7EE] text-[#16834A]",
    gold: "bg-[#FFF8E8] text-[#A56607]",
    purple: "bg-[#F1EBFF] text-[#6D35D4]",
    red: "bg-[#FFF0F0] text-[#C32F2F]",
    neutral: "bg-[#F1EEF5] text-[#7A6A84]",
};

export function StatusPill({ label, tone }: { label: string; tone: PillTone }) {
    return (
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${PILL_TONE_STYLE[tone]}`}>
      {label}
    </span>
    );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export function PrimaryButton({
                                  children,
                                  onClick,
                                  disabled,
                                  type = "button",
                              }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: "button" | "submit";
}) {
    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-xl bg-[#2B174C] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-50"
        >
            {children}
        </button>
    );
}

export function GhostButton({
                                children,
                                onClick,
                                tone = "neutral",
                            }: {
    children: ReactNode;
    onClick?: () => void;
    tone?: "neutral" | "danger";
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={
                tone === "danger"
                    ? "rounded-lg border border-[#E6DDF0] bg-white px-3 py-1.5 text-xs font-semibold text-[#C32F2F] hover:bg-[#FFF0F0]"
                    : "rounded-lg border border-[#E6DDF0] bg-white px-3 py-1.5 text-xs font-semibold text-[#1A1220] hover:bg-[#FAF8FF]"
            }
        >
            {children}
        </button>
    );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export function SearchInput({
                                value,
                                onChange,
                                placeholder,
                            }: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
}) {
    return (
        <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-xl border border-[#E6DDF0] bg-white px-3.5 py-2.5 text-xs outline-none transition focus:border-[#2B174C]"
        />
    );
}

export function SelectFilter({
                                 value,
                                 options,
                                 onChange,
                             }: {
    value: string;
    options: string[];
    onChange: (v: string) => void;
}) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="rounded-xl border border-[#E6DDF0] bg-white px-3.5 py-2.5 text-xs outline-none transition focus:border-[#2B174C]"
        >
            {options.map((opt) => (
                <option key={opt} value={opt}>
                    {opt}
                </option>
            ))}
        </select>
    );
}

// ---------------------------------------------------------------------------
// Modal — identical chrome to the dashboard's "Review Payment" dialog
// ---------------------------------------------------------------------------

export function Modal({
                          title,
                          subtitle,
                          onClose,
                          children,
                          maxWidth = "max-w-lg",
                      }: {
    title: string;
    subtitle?: string;
    onClose: () => void;
    children: ReactNode;
    maxWidth?: string;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
            <div className={`w-full ${maxWidth} rounded-[18px] border border-[#E6DDF0] bg-white p-6 shadow-2xl`}>
                <div className="flex items-center justify-between border-b border-[#EEE8F2] pb-4">
                    <div>
                        <h3 className="text-lg font-bold text-[#1A1220]">{title}</h3>
                        {subtitle && <p className="text-xs text-[#8A7D92]">{subtitle}</p>}
                    </div>
                    <button type="button" onClick={onClose} className="text-[#806A8C] hover:text-[#1A1220]">
                        <X size={20} />
                    </button>
                </div>
                <div className="mt-4">{children}</div>
            </div>
        </div>
    );
}