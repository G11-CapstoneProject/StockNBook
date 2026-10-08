"use client";

import type { ReactNode } from "react";

type ModuleSkeletonVariant =
    | "bookings"
    | "inventory"
    | "packages"
    | "pos"
    | "analytics"
    | "forecasting"
    | "reports"
    | "branches"
    | "team"
    | "subscription"
    | "settings";

function Pulse({ className = "" }: { className?: string }) {
    return <div className={`animate-pulse rounded-lg bg-[#EEE8F3] ${className}`} />;
}

function CardShell({ children, className = "" }: { children: ReactNode; className?: string }) {
    return (
        <div className={`rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm ${className}`}>
            {children}
        </div>
    );
}

function PanelHeading({ action = false }: { action?: boolean }) {
    return (
        <div className="flex items-start justify-between gap-3 border-b border-[#EEE8F3] px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
                <Pulse className="h-9 w-9 shrink-0 rounded-xl" />
                <div className="space-y-2">
                    <Pulse className="h-3.5 w-32" />
                    <Pulse className="h-2.5 w-48 max-w-[48vw]" />
                </div>
            </div>
            {action ? <Pulse className="h-8 w-24 shrink-0 rounded-xl" /> : null}
        </div>
    );
}

function MetricCards({ count = 4 }: { count?: number }) {
    return (
        <div className={`grid gap-3 ${count >= 4 ? "sm:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3"}`}>
            {Array.from({ length: count }, (_, index) => (
                <CardShell key={index} className="p-4">
                    <div className="flex items-center gap-3">
                        <Pulse className="h-11 w-11 shrink-0 rounded-full" />
                        <div className="min-w-0 flex-1 space-y-2">
                            <Pulse className="h-3 w-24" />
                            <Pulse className="h-6 w-20" />
                            <Pulse className="h-2.5 w-32 max-w-full" />
                        </div>
                    </div>
                </CardShell>
            ))}
        </div>
    );
}

function ToolbarSkeleton({ filters = 3 }: { filters?: number }) {
    return (
        <CardShell className="p-3">
            <div className="flex flex-wrap items-center gap-2.5">
                <Pulse className="h-9 min-w-[220px] flex-1" />
                {Array.from({ length: filters }, (_, index) => (
                    <Pulse key={index} className="h-9 w-32 rounded-xl" />
                ))}
                <Pulse className="h-9 w-24 rounded-xl" />
            </div>
        </CardShell>
    );
}

function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
    return (
        <CardShell className="overflow-hidden">
            <PanelHeading action />
            <div className="border-b border-[#EEE8F3] bg-[#FBF9FD] px-4 py-3">
                <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                    {Array.from({ length: columns }, (_, index) => (
                        <Pulse key={index} className="h-2.5 w-16" />
                    ))}
                </div>
            </div>
            <div className="divide-y divide-[#F0EAF4]">
                {Array.from({ length: rows }, (_, row) => (
                    <div key={row} className="grid items-center gap-4 px-4 py-3.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                        {Array.from({ length: columns }, (_, column) => (
                            <div key={column} className="space-y-1.5">
                                <Pulse className={`h-3 ${column === 0 ? "w-28" : column === columns - 1 ? "w-16" : "w-20"} max-w-full`} />
                                {column === 1 ? <Pulse className="h-2.5 w-24 max-w-full" /> : null}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </CardShell>
    );
}

function GridCardsSkeleton({ count = 8 }: { count?: number }) {
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: count }, (_, index) => (
                <CardShell key={index} className="overflow-hidden p-4">
                    <Pulse className="h-28 w-full rounded-xl" />
                    <div className="mt-4 space-y-2">
                        <Pulse className="h-4 w-3/5" />
                        <Pulse className="h-3 w-4/5" />
                        <Pulse className="h-3 w-2/3" />
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                        <Pulse className="h-7 w-20 rounded-full" />
                        <Pulse className="h-8 w-20 rounded-xl" />
                    </div>
                </CardShell>
            ))}
        </div>
    );
}

function ChartSkeleton() {
    return (
        <CardShell className="min-h-[320px] overflow-hidden">
            <PanelHeading action />
            <div className="px-5 pb-5 pt-4">
                <div className="relative h-[210px] overflow-hidden rounded-xl border border-[#F0EAF4] bg-[#FCFBFD]">
                    <div className="absolute inset-x-4 top-8 space-y-9">
                        {Array.from({ length: 4 }, (_, index) => (
                            <div key={index} className="h-px bg-[#EEE8F3]" />
                        ))}
                    </div>
                    <div className="absolute bottom-9 left-[7%] h-12 w-[12%] rounded-t-lg bg-[#E8DFF3]" />
                    <div className="absolute bottom-9 left-[24%] h-24 w-[12%] rounded-t-lg bg-[#E8DFF3]" />
                    <div className="absolute bottom-9 left-[41%] h-16 w-[12%] rounded-t-lg bg-[#E8DFF3]" />
                    <div className="absolute bottom-9 left-[58%] h-32 w-[12%] rounded-t-lg bg-[#E8DFF3]" />
                    <div className="absolute bottom-9 left-[75%] h-20 w-[12%] rounded-t-lg bg-[#E8DFF3]" />
                </div>
                <div className="mt-4 flex justify-center gap-4">
                    <Pulse className="h-3 w-20" />
                    <Pulse className="h-3 w-20" />
                    <Pulse className="h-3 w-20" />
                </div>
            </div>
        </CardShell>
    );
}

function DonutSkeleton() {
    return (
        <CardShell className="min-h-[300px] overflow-hidden">
            <PanelHeading />
            <div className="grid gap-6 p-5 md:grid-cols-[150px_minmax(0,1fr)] md:items-center">
                <div className="mx-auto h-36 w-36 animate-pulse rounded-full border-[24px] border-[#EEE8F3]" />
                <div className="space-y-4">
                    {Array.from({ length: 4 }, (_, index) => (
                        <div key={index} className="flex items-center gap-3">
                            <Pulse className="h-3 w-3 rounded-full" />
                            <Pulse className="h-3 flex-1" />
                            <Pulse className="h-3 w-10" />
                        </div>
                    ))}
                </div>
            </div>
        </CardShell>
    );
}

function ReportsSkeleton() {
    return (
        <div className="space-y-4" aria-hidden="true">
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                {Array.from({ length: 6 }, (_, index) => (
                    <CardShell key={index} className="p-3.5">
                        <div className="flex items-center gap-2.5">
                            <Pulse className="h-9 w-9 rounded-xl" />
                            <div className="flex-1 space-y-2"><Pulse className="h-3 w-20" /><Pulse className="h-2.5 w-full" /></div>
                        </div>
                    </CardShell>
                ))}
            </div>
            <ToolbarSkeleton filters={4} />
            <TableSkeleton rows={7} columns={6} />
        </div>
    );
}

function POSSkeleton() {
    return (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,.75fr)]" aria-hidden="true">
            <div className="space-y-4">
                <ToolbarSkeleton filters={2} />
                <GridCardsSkeleton count={8} />
            </div>
            <CardShell className="min-h-[620px] overflow-hidden">
                <PanelHeading />
                <div className="space-y-3 p-4">
                    {Array.from({ length: 5 }, (_, index) => (
                        <div key={index} className="flex items-center gap-3 rounded-xl border border-[#EEE8F3] p-3">
                            <Pulse className="h-10 w-10 rounded-lg" />
                            <div className="flex-1 space-y-2"><Pulse className="h-3 w-32" /><Pulse className="h-2.5 w-20" /></div>
                            <Pulse className="h-7 w-16" />
                        </div>
                    ))}
                    <div className="mt-6 space-y-3 border-t border-[#EEE8F3] pt-4">
                        <div className="flex justify-between"><Pulse className="h-3 w-24" /><Pulse className="h-4 w-20" /></div>
                        <div className="flex justify-between"><Pulse className="h-3 w-20" /><Pulse className="h-5 w-24" /></div>
                        <Pulse className="h-11 w-full rounded-xl" />
                    </div>
                </div>
            </CardShell>
        </div>
    );
}

export function ModuleSkeleton({ variant, className = "" }: { variant: ModuleSkeletonVariant; className?: string }) {
    let content: ReactNode = null;

    switch (variant) {
        case "bookings":
            content = <><MetricCards count={3} /><ToolbarSkeleton filters={3} /><TableSkeleton rows={7} columns={6} /></>;
            break;
        case "inventory":
            content = <><MetricCards count={4} /><ToolbarSkeleton filters={3} /><TableSkeleton rows={7} columns={7} /></>;
            break;
        case "packages":
            content = <><MetricCards count={3} /><ToolbarSkeleton filters={2} /><GridCardsSkeleton count={8} /></>;
            break;
        case "pos":
            content = <POSSkeleton />;
            break;
        case "analytics":
            content = <><ToolbarSkeleton filters={3} /><MetricCards count={4} /><div className="grid gap-3 xl:grid-cols-2"><ChartSkeleton /><ChartSkeleton /><ChartSkeleton /><ChartSkeleton /></div></>;
            break;
        case "forecasting":
            content = <><MetricCards count={4} /><ToolbarSkeleton filters={2} /><div className="grid gap-3 xl:grid-cols-2"><ChartSkeleton /><TableSkeleton rows={5} columns={4} /></div></>;
            break;
        case "reports":
            content = <ReportsSkeleton />;
            break;
        case "branches":
            content = <><MetricCards count={4} /><ToolbarSkeleton filters={2} /><GridCardsSkeleton count={6} /></>;
            break;
        case "team":
            content = <><MetricCards count={3} /><ToolbarSkeleton filters={2} /><TableSkeleton rows={7} columns={5} /></>;
            break;
        case "subscription":
            content = <><MetricCards count={4} /><div className="grid gap-4 xl:grid-cols-[1fr_1.25fr]"><CardShell className="min-h-[360px] p-5"><Pulse className="h-5 w-40" /><Pulse className="mt-3 h-3 w-56" /><div className="mt-6 space-y-4">{Array.from({length:4},(_,i)=><div key={i}><div className="mb-2 flex justify-between"><Pulse className="h-3 w-28"/><Pulse className="h-3 w-12"/></div><Pulse className="h-2 w-full rounded-full"/></div>)}</div></CardShell><GridCardsSkeleton count={3}/></div></>;
            break;
        case "settings":
            content = <div className="grid gap-4 xl:grid-cols-2"><CardShell className="p-5"><PanelHeading/><div className="space-y-4 p-4"><Pulse className="h-10 w-full"/><Pulse className="h-10 w-full"/><Pulse className="h-10 w-2/3"/><Pulse className="h-11 w-32"/></div></CardShell><CardShell className="p-5"><Pulse className="mx-auto h-44 w-44 rounded-xl"/><Pulse className="mx-auto mt-5 h-3 w-48"/><Pulse className="mx-auto mt-3 h-9 w-28"/></CardShell></div>;
            break;
    }

    return <div className={`space-y-4 ${className}`} aria-busy="true" aria-label={`Loading ${variant}`}>{content}</div>;
}

export function ModulePageSkeleton({ variant }: { variant: ModuleSkeletonVariant }) {
    return (
        <section className="px-6 py-4">
            <ModuleSkeleton variant={variant} />
        </section>
    );
}