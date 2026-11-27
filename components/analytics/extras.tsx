"use client";

/*
 * Analytics building blocks and the two lookup sections.
 *   - UI pieces shared by the Analytics page: Card, Kpi, Tabs, Segmented, ChangeChip, BarList, LineChart, Heatmap
 *   - BuyingTimes: when customers buy (by day or by category, per hour)
 *   - RentalMonthHeatmap: which rental items are booked in which month
 *   - MonthComparisonSection: a month vs the same month last year
 *   - ItemInsightSection: one product or rental item over the last three years
 *
 * Layout uses inline styles so it looks the same even if Tailwind did not generate a class.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

/* -------------------------------------------------------
 * TOKENS AND FORMATTING
 * ------------------------------------------------------- */

export const C = {
    ink: "#2B174C",
    text: "#4D3862",
    muted: "#7A6A84",
    line: "#E6DDF0",
    soft: "#FBF8FF",
    accent: "#7651A5",
    lastYear: "#eb6834",
    up: "#138342",
    down: "#B3261E",
    track: "#F0EAF5",
};
// Series colors in a fixed order: purple, orange, green, blue.
export const SERIES = ["#7651A5", "#eb6834", "#1baf7a", "#2a78d6"];

export type Change = { percentage: number | null; direction: string; label: string; explanation?: string };

export const fmt = (value: number, digits = 0) =>
    new Intl.NumberFormat("en-PH", { maximumFractionDigits: digits }).format(Number.isFinite(value) ? value : 0);
export const peso = (value: number) =>
    new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(value || 0);
export const hourLabel = (hour: number) => `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
const shortHour = (hour: number) => `${hour % 12 || 12}${hour < 12 ? "a" : "p"}`;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dateText(iso: string, withYear = true) {
    const date = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

export function dateRangeText(start: string, end: string) {
    if (!start || !end) return "";
    const sameYear = start.slice(0, 4) === end.slice(0, 4);
    return `${dateText(start, !sameYear)} – ${dateText(end)}`;
}

function token() {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem("token") || localStorage.getItem("token") || "";
}

export async function analyticsRequest<T>(body: Record<string, unknown>): Promise<T> {
    const authToken = token();
    if (!authToken) throw new Error("You are signed out. Please sign in again.");
    const response = await fetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(body),
        cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) throw new Error(payload.error || "Something went wrong. Please try again.");
    return payload as T;
}

/* -------------------------------------------------------
 * UI PIECES
 * ------------------------------------------------------- */

export const inputStyle: CSSProperties = {
    border: `1px solid ${C.line}`, borderRadius: 10, background: "#fff", padding: "8px 10px",
    fontSize: 13, color: C.ink, minWidth: 0, height: 38, boxSizing: "border-box",
};

export const grid = (min: number, gap = 12): CSSProperties => ({
    display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap,
});

export function Card({ title, sub, action, children, style }: {
    title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; style?: CSSProperties;
}) {
    return (
        <section style={{ border: `1px solid ${C.line}`, borderRadius: 14, background: "#fff", padding: 16, minWidth: 0, ...style }}>
            {(title || action) && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
                    <div style={{ minWidth: 0 }}>
                        {title && <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.ink }}>{title}</h3>}
                        {sub && <p style={{ margin: "3px 0 0", fontSize: 12, lineHeight: "18px", color: C.muted }}>{sub}</p>}
                    </div>
                    {action}
                </div>
            )}
            {children}
        </section>
    );
}

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
    return (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, background: "#fff", padding: "14px 16px", minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.muted }}>{label}</p>
            <p style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 700, color: C.ink, lineHeight: 1.2, overflowWrap: "anywhere" }}>{value}</p>
            {sub && <div style={{ margin: "6px 0 0", fontSize: 12, color: C.muted, lineHeight: "18px" }}>{sub}</div>}
        </div>
    );
}

/** ▲ 12% (green), ▼ 8% (red), "New" or "–" when there is nothing to compare with. */
export function ChangeChip({ change, compact = false }: { change?: Change | null; compact?: boolean }) {
    if (!change || change.percentage === null || change.percentage === undefined) {
        const isNew = change?.direction === "new-activity";
        return <span style={{ color: isNew ? C.up : C.muted, fontWeight: 600 }}>{isNew ? "New" : "–"}</span>;
    }
    const value = change.percentage;
    const color = value > 0 ? C.up : value < 0 ? C.down : C.muted;
    const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "";
    return (
        <span style={{ color, fontWeight: 600, whiteSpace: "nowrap" }}>
            {arrow && <span aria-hidden style={{ fontSize: compact ? 9 : 10, marginRight: 3 }}>{arrow}</span>}
            <span style={{ position: "absolute", left: -9999 }}>{value > 0 ? "up " : value < 0 ? "down " : ""}</span>
            {fmt(Math.abs(value), Math.abs(value) < 10 ? 1 : 0)}%
        </span>
    );
}

export function Empty({ children }: { children: ReactNode }) {
    return (
        <div style={{ border: `1px dashed ${C.line}`, borderRadius: 12, padding: "20px 16px", textAlign: "center", fontSize: 13, color: C.muted, lineHeight: "20px" }}>
            {children}
        </div>
    );
}

export function Loading({ label }: { label: string }) {
    return <div role="status" style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, textAlign: "center", fontSize: 13, color: C.muted, background: "#fff" }}>Loading {label}…</div>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
        <div role="alert" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, border: "1px solid #F2C4C4", background: "#FFF6F6", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: "#8E2D2D" }}>
            <span>{message}</span>
            {onRetry && <button type="button" onClick={onRetry} style={buttonStyle()}>Try again</button>}
        </div>
    );
}

export const buttonStyle = (primary = false): CSSProperties => ({
    border: `1px solid ${primary ? C.ink : C.line}`, background: primary ? C.ink : "#fff", color: primary ? "#fff" : C.ink,
    borderRadius: 10, padding: "0 14px", height: 36, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
});

/** Page-level tabs with arrow-key support. */
export function Tabs<T extends string>({ tabs, value, onChange, label, idPrefix }: {
    tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void; label: string; idPrefix: string;
}) {
    const refs = useRef<(HTMLButtonElement | null)[]>([]);
    const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const next = (index + step + tabs.length) % tabs.length;
        onChange(tabs[next].id);
        refs.current[next]?.focus();
    };
    return (
        <div role="tablist" aria-label={label} style={{ display: "flex", gap: 4, overflowX: "auto", borderBottom: `1px solid ${C.line}`, scrollbarWidth: "thin" }}>
            {tabs.map((tab, index) => {
                const active = tab.id === value;
                return (
                    <button key={tab.id} ref={(el) => { refs.current[index] = el; }} type="button" role="tab" id={`${idPrefix}-tab-${tab.id}`}
                            aria-selected={active} aria-controls={`${idPrefix}-panel`} tabIndex={active ? 0 : -1}
                            onClick={() => onChange(tab.id)} onKeyDown={(event) => onKey(event, index)}
                            style={{ border: 0, borderBottom: `3px solid ${active ? C.accent : "transparent"}`, background: "transparent",
                                color: active ? C.ink : C.muted, fontWeight: active ? 700 : 600, fontSize: 14, padding: "10px 12px 9px",
                                cursor: "pointer", whiteSpace: "nowrap", marginBottom: -1 }}>
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
}

/** Small two-to-four option switch inside a card. */
export function Segmented<T extends string>({ options, value, onChange, label }: {
    options: { id: T; label: string }[]; value: T; onChange: (id: T) => void; label: string;
}) {
    return (
        <div role="group" aria-label={label} style={{ display: "inline-flex", border: `1px solid ${C.line}`, borderRadius: 10, padding: 2, background: C.soft, flexWrap: "wrap" }}>
            {options.map((option) => {
                const on = option.id === value;
                return (
                    <button key={option.id} type="button" aria-pressed={on} onClick={() => onChange(option.id)}
                            style={{ border: 0, borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                                background: on ? "#fff" : "transparent", color: on ? C.ink : C.muted,
                                boxShadow: on ? "0 1px 2px rgba(43,23,76,0.15)" : "none" }}>
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

/** Ranked horizontal bars. */
export function BarList({ items, format = (v) => fmt(v), empty = "Nothing to show for this period.", onPick, color = C.accent }: {
    items: { key?: string; name: string; value: number; extra?: ReactNode }[];
    format?: (value: number) => string;
    empty?: string;
    onPick?: (key: string) => void;
    color?: string;
}) {
    if (!items.length) return <Empty>{empty}</Empty>;
    const max = Math.max(1, ...items.map((item) => item.value));
    return (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr)" }}>
            {items.map((item, index) => {
                const body = (
                    <>
                        <span style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.text }} title={item.name}>{item.name}</span>
                            <span style={{ flexShrink: 0, display: "inline-flex", gap: 8, alignItems: "baseline" }}>
                                <strong style={{ color: C.ink }}>{format(item.value)}</strong>
                                {item.extra && <span style={{ fontSize: 12 }}>{item.extra}</span>}
                            </span>
                        </span>
                        <span aria-hidden style={{ display: "block", height: 8, borderRadius: 4, background: C.track, marginTop: 5, overflow: "hidden" }}>
                            <span style={{ display: "block", height: "100%", width: `${(Math.max(0, item.value) / max) * 100}%`, background: color, borderRadius: 4 }} />
                        </span>
                    </>
                );
                return (
                    <li key={item.key || `${item.name}-${index}`}>
                        {onPick && item.key ? (
                            <button type="button" onClick={() => onPick(item.key as string)} title={`Show ${item.name}`}
                                    style={{ all: "unset", display: "block", width: "100%", cursor: "pointer", boxSizing: "border-box" }}>{body}</button>
                        ) : body}
                    </li>
                );
            })}
        </ol>
    );
}

/** Width of an element in pixels, so charts keep real-size text at any screen width. */
export function useElementWidth<T extends HTMLElement>(fallback = 720) {
    const ref = useRef<T | null>(null);
    const [width, setWidth] = useState(fallback);
    useEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const update = () => setWidth(Math.max(280, Math.round(el.getBoundingClientRect().width)));
        update();
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    return [ref, width] as const;
}

// "Nov 2025" -> ["Nov", "2025"]; other labels unchanged.
function splitMonthLabel(label: string): [string, string] {
    const match = /^([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/.exec(label.trim());
    return match ? [match[1], match[2]] : [label, ""];
}

/** Line chart with a hover readout. Every series has one value per label. */
export function LineChart({ labels, series, format = (v) => fmt(v), height = 240, ariaLabel }: {
    labels: string[];
    series: { name: string; color: string; values: (number | null)[]; dashed?: boolean }[];
    format?: (value: number) => string;
    height?: number;
    ariaLabel: string;
}) {
    const [hover, setHover] = useState<number | null>(null);
    const [boxRef, boxWidth] = useElementWidth<HTMLDivElement>();
    if (!labels.length) return <Empty>Nothing to show for this period.</Empty>;
    const split = labels.map(splitMonthLabel);
    const hasYears = split.some(([, year]) => year);
    const W = boxWidth, H = height + (hasYears ? 12 : 0), L = 56, R = 20, T = 14, B = hasYears ? 42 : 30;
    const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => v || 0)));
    const step = labels.length > 1 ? (W - L - R) / (labels.length - 1) : 0;
    const x = (i: number) => (labels.length > 1 ? L + i * step : (L + W - R) / 2);
    const y = (v: number) => T + (H - T - B) - (Math.max(0, v) / max) * (H - T - B);
    const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor((W - L - R) / 56))));
    const compact = (v: number) => (v >= 1_000_000 ? `${fmt(v / 1_000_000, 1)}M` : v >= 10_000 ? `${fmt(v / 1000)}k` : fmt(v));
    return (
        <div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, color: C.text, marginBottom: 6 }}>
                {series.map((s) => (
                    <span key={s.name} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span aria-hidden style={{ width: 16, height: 0, borderTop: `3px ${s.dashed ? "dashed" : "solid"} ${s.color}` }} />{s.name}
                    </span>
                ))}
            </div>
            <div ref={boxRef} style={{ position: "relative" }}>
                <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
                    {[0, 0.5, 1].map((t) => (
                        <g key={t}>
                            <line x1={L} x2={W - R} y1={y(max * t)} y2={y(max * t)} stroke="#EEE8F3" />
                            <text x={L - 8} y={y(max * t) + 4} textAnchor="end" fontSize="11" fill={C.muted}>{compact(max * t)}</text>
                        </g>
                    ))}
                    {split.map(([main, year], i) => (i % every === 0 || i === labels.length - 1) && (
                        <text key={i} x={x(i)} y={H - (year ? 22 : 10)} textAnchor={labels.length > 1 && i === labels.length - 1 ? "end" : labels.length > 1 && i === 0 ? "start" : "middle"} fontSize="11" fill={C.muted}>
                            {main}
                            {year && (i === 0 || main === "Jan") && <tspan x={x(i)} dy="13">{year}</tspan>}
                        </text>
                    ))}
                    {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#C9BCD8" />}
                    {series.map((s, si) => {
                        let d = "";
                        const parts: string[] = [];
                        s.values.forEach((v, i) => {
                            if (v === null || v === undefined) { if (d) { parts.push(d); d = ""; } return; }
                            d += `${d ? "L" : "M"}${x(i)} ${y(v)} `;
                        });
                        if (d) parts.push(d);
                        return (
                            <g key={s.name}>
                                {parts.map((p, k) => <path key={k} d={p} fill="none" stroke={s.color} strokeWidth={si === 0 ? 3 : 2} strokeDasharray={s.dashed ? "6 5" : undefined} strokeLinejoin="round" strokeLinecap="round" />)}
                                {s.values.map((v, i) => v !== null && v !== undefined && (hover === i || labels.length === 1) ? <circle key={i} cx={x(i)} cy={y(v)} r={4.5} fill={s.color} stroke="#fff" strokeWidth={2} /> : null)}
                            </g>
                        );
                    })}
                    {labels.map((_, i) => (
                        <rect key={i} x={x(i) - Math.max(step, 20) / 2} y={T} width={Math.max(step, 20)} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />
                    ))}
                </svg>
                {hover !== null && (
                    <div style={{ position: "absolute", top: 6, left: `${Math.min(68, Math.max(2, (x(hover) / W) * 100 - 8))}%`, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px", fontSize: 12, boxShadow: "0 4px 12px rgba(43,23,76,0.12)", pointerEvents: "none", whiteSpace: "nowrap" }}>
                        <strong style={{ color: C.ink }}>{labels[hover]}</strong>
                        {series.map((s) => (
                            <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 6, color: C.text }}>
                                <span style={{ width: 8, height: 8, borderRadius: 4, background: s.color }} />{s.name}: {s.values[hover] === null || s.values[hover] === undefined ? "–" : format(s.values[hover] as number)}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

/* -------------------------------------------------------
 * HEATMAP
 * ------------------------------------------------------- */

type HeatRow = { label: string; values: number[] };

// Light to dark purple (one hue) for "how many".
function rampColor(t: number) {
    const a = [243, 238, 249], b = [61, 33, 96];
    const v = Math.max(0, Math.min(1, t));
    const c = a.map((start, i) => Math.round(start + (b[i] - start) * v));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function Heatmap({ rows, columns, unit, caption, perRow = false }: { rows: HeatRow[]; columns: string[]; unit: string; caption: string; perRow?: boolean }) {
    const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
    if (!rows.length) return <Empty>Nothing to show for this period.</Empty>;
    const max = Math.max(1, ...rows.flatMap((r) => r.values));
    const rowMax = rows.map((r) => Math.max(1, ...r.values));
    const shown = hover ? rows[hover.row] : null;
    return (
        <div>
            <div style={{ overflowX: "auto" }}>
                <table aria-label={caption} style={{ borderCollapse: "separate", borderSpacing: 2, fontSize: 11, width: "100%", minWidth: 110 + columns.length * 24 }}>
                    <thead>
                    <tr>
                        <th scope="col" style={{ padding: 0 }}><span style={{ position: "absolute", left: -9999 }}>{caption}</span></th>
                        {columns.map((c) => <th key={c} scope="col" style={{ color: C.muted, fontWeight: 500, padding: "0 0 4px", whiteSpace: "nowrap" }}>{c}</th>)}
                    </tr>
                    </thead>
                    <tbody>
                    {rows.map((r, ri) => (
                        <tr key={r.label}>
                            <th scope="row" title={r.label} style={{ textAlign: "left", color: C.text, fontWeight: 500, padding: "0 8px 0 0", whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</th>
                            {r.values.map((v, ci) => (
                                <td key={ci} onMouseEnter={() => setHover({ row: ri, col: ci })} onMouseLeave={() => setHover(null)}
                                    title={`${r.label}, ${columns[ci]}: ${fmt(v)} ${unit}`}
                                    style={{ minWidth: 20, height: 24, borderRadius: 4, background: v > 0 ? rampColor(v / (perRow ? rowMax[ri] : max)) : "#F7F4FA",
                                        outline: hover && hover.row === ri && hover.col === ci ? `2px solid ${C.ink}` : "none", outlineOffset: -1 }} />
                            ))}
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8, fontSize: 12, color: C.muted }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    Fewer
                    <span aria-hidden style={{ display: "inline-block", width: 80, height: 8, borderRadius: 4, background: `linear-gradient(90deg, ${rampColor(0.05)}, ${rampColor(1)})` }} />
                    More
                </span>
                <span aria-live="polite" style={{ color: C.text, fontWeight: 600 }}>
                    {shown && hover ? `${shown.label}, ${columns[hover.col]}: ${fmt(shown.values[hover.col])} ${unit}` : ""}
                </span>
            </div>
            <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: "pointer", fontSize: 12, color: C.text }}>Show numbers</summary>
                <div style={{ overflowX: "auto", marginTop: 6 }}>
                    <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
                        <thead><tr><th style={{ textAlign: "left", padding: 4 }}>{caption}</th>{columns.map((c) => <th key={c} style={{ padding: 4 }}>{c}</th>)}</tr></thead>
                        <tbody>{rows.map((r) => <tr key={r.label}><th style={{ textAlign: "left", padding: 4, fontWeight: 500 }}>{r.label}</th>{r.values.map((v, i) => <td key={i} style={{ padding: 4, textAlign: "right" }}>{fmt(v)}</td>)}</tr>)}</tbody>
                    </table>
                </div>
            </details>
        </div>
    );
}

// Only the hours that have sales (the store's opening hours).
function openHours(rows: { hours: number[] }[]) {
    const used = Array.from({ length: 24 }, (_, h) => rows.some((r) => (r.hours[h] || 0) > 0));
    const first = used.indexOf(true), last = used.lastIndexOf(true);
    return first < 0 ? [] : Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export function BuyingTimes({ categoryHourly, weekdayHourly }: {
    categoryHourly?: { name: string; units: number; peakHour: number; hours: number[] }[];
    weekdayHourly?: { weekday: number; label: string; units: number; hours: number[] }[];
}) {
    const [view, setView] = useState<"day" | "category">("day");
    if (!categoryHourly?.length || !weekdayHourly?.length) return <Empty>No sales in this period.</Empty>;
    const hours = openHours([...categoryHourly, ...weekdayHourly]);
    const columns = hours.map(shortHour);
    const busiest = weekdayHourly.flatMap((d) => d.hours.map((u, h) => ({ day: d.weekday, h, u }))).sort((a, b) => b.u - a.u)[0];
    const busiestDay = [...weekdayHourly].sort((a, b) => b.units - a.units)[0];
    return (
        <Card title="When customers buy"
              sub={busiest && busiest.u > 0 ? <>Busiest: <strong style={{ color: C.ink }}>{WEEKDAYS[busiest.day]}s around {hourLabel(busiest.h)}</strong>. Busiest day overall: {WEEKDAYS[busiestDay.weekday]}.</> : undefined}
              action={<Segmented label="Group by" value={view} onChange={setView} options={[{ id: "day", label: "By day" }, { id: "category", label: "By category" }]} />}>
            {view === "day" ? (
                <Heatmap caption="Day" unit="units" columns={columns}
                         rows={[1, 2, 3, 4, 5, 6, 0].map((d) => weekdayHourly.find((w) => w.weekday === d)).filter((d): d is NonNullable<typeof d> => Boolean(d))
                             .map((d) => ({ label: WEEKDAYS[d.weekday], values: hours.map((h) => d.hours[h] || 0) }))} />
            ) : (
                <>
                    <p style={{ margin: "0 0 8px", fontSize: 12, color: C.muted }}>Each row is shaded by its own busiest hour, so small categories still show their peak.</p>
                    <Heatmap caption="Category" unit="units" columns={columns} perRow
                             rows={categoryHourly.map((c) => ({ label: c.name, values: hours.map((h) => c.hours[h] || 0) }))} />
                </>
            )}
        </Card>
    );
}

export function RentalMonthHeatmap({ data }: {
    data?: { months: { key: string; label: string }[]; items: { name: string; units: number[]; total: number }[] };
}) {
    if (!data) return null;
    return (
        <Card title="Rental items by month" sub="Units booked for events in each month (12 most booked items). Each row is shaded by its own busiest month.">
            {data.items.length ? (
                <Heatmap caption="Rental item" unit="units booked" perRow columns={data.months.map((m) => splitMonthLabel(m.label)[0])}
                         rows={data.items.map((i) => ({ label: i.name, values: i.units }))} />
            ) : <Empty>No rental bookings in this period.</Empty>}
        </Card>
    );
}

/* -------------------------------------------------------
 * A MONTH VS THE SAME MONTH LAST YEAR
 * ------------------------------------------------------- */

type ComparedProduct = { productId: number; name: string; category: string; units: number; lastYearUnits: number; difference: number; change: Change };
type MonthComparison = {
    month: string; label: string; lastYearLabel: string; partial: boolean; startDate: string; endDate: string;
    lastYearStartDate: string; lastYearEndDate: string; days: number;
    totals: { units: number; lastYearUnits: number; unitsChange: Change; revenue: number; lastYearRevenue: number; revenueChange: Change };
    categories: { name: string; units: number; lastYearUnits: number; change: Change }[];
    products: ComparedProduct[];
    mostSold: ComparedProduct[]; leastSold: ComparedProduct[]; biggestIncrease: ComparedProduct[]; biggestDecrease: ComparedProduct[];
    rentals: { equipmentId: number; name: string; units: number; lastYearUnits: number; difference: number; change: Change }[];
};

function currentMonthKey() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

function MoverList({ items, empty }: { items: ComparedProduct[]; empty: string }) {
    if (!items.length) return <p style={{ margin: 0, fontSize: 13, color: C.muted }}>{empty}</p>;
    return (
        <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {items.slice(0, 5).map((p) => (
                <li key={p.productId} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderTop: `1px solid ${C.track}`, fontSize: 13 }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.text }} title={p.name}>{p.name}</span>
                    <span style={{ flexShrink: 0, color: C.muted }}>
                        <strong style={{ color: C.ink }}>{fmt(p.units)}</strong> vs {fmt(p.lastYearUnits)} · <ChangeChip change={p.change} compact />
                    </span>
                </li>
            ))}
        </ol>
    );
}

type SortKey = "name" | "units" | "lastYearUnits" | "change";

export function MonthComparisonSection({ branchId }: { branchId: number | null }) {
    const [month, setMonth] = useState(currentMonthKey());
    const [tick, setTick] = useState(0);
    // State changes only when a response arrives; "loading" means the shown result is not for the current choice.
    const requestKey = `${month}|${branchId ?? "all"}|${tick}`;
    const [result, setResult] = useState<{ key: string; data: MonthComparison | null; error: string }>({ key: "", data: null, error: "" });
    const data = result.data;
    const loading = result.key !== requestKey;
    const error = loading ? "" : result.error;
    const [category, setCategory] = useState("All");
    const [query, setQuery] = useState("");
    const [showAll, setShowAll] = useState(false);
    const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "units", desc: true });

    useEffect(() => {
        let cancelled = false;
        analyticsRequest<MonthComparison>({ action: "get_month_comparison", month, ...(branchId ? { branch_id: branchId } : {}) })
            .then((d) => { if (!cancelled) setResult({ key: requestKey, data: d, error: "" }); })
            .catch((e) => { if (!cancelled) setResult({ key: requestKey, data: null, error: e instanceof Error ? e.message : "Could not load the comparison." }); });
        return () => { cancelled = true; };
    }, [month, branchId, requestKey]);

    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = (data?.products || []).filter((p) => (category === "All" || p.category === category) && (!q || p.name.toLowerCase().includes(q)));
        const value = (p: ComparedProduct) => sort.key === "change" ? (p.change.percentage ?? (p.units > 0 ? Infinity : -Infinity)) : sort.key === "name" ? 0 : p[sort.key];
        return [...list].sort((a, b) => sort.key === "name"
            ? a.name.localeCompare(b.name) * (sort.desc ? -1 : 1)
            : (value(a) - value(b)) * (sort.desc ? -1 : 1) || a.name.localeCompare(b.name));
    }, [data, category, query, sort]);
    const maxUnits = Math.max(1, ...(data?.categories || []).flatMap((c) => [c.units, c.lastYearUnits]));

    const header = (key: SortKey, label: string, align: "left" | "right") => {
        const active = sort.key === key;
        return (
            <th scope="col" aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"} style={{ textAlign: align, padding: 0 }}>
                <button type="button" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))}
                        style={{ all: "unset", cursor: "pointer", display: "block", padding: "9px 10px", fontSize: 12, fontWeight: 600, color: active ? C.ink : C.muted, textAlign: align, width: "100%", boxSizing: "border-box" }}>
                    {label}{active ? (sort.desc ? " ↓" : " ↑") : ""}
                </button>
            </th>
        );
    };

    return (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
            <Card title={data ? `${data.label} vs ${data.lastYearLabel}` : "Compare a month with last year"}
                  sub={data ? (data.partial
                      ? `This month is not over yet, so both years cover the same days: ${dateRangeText(data.startDate, data.endDate)} vs ${dateRangeText(data.lastYearStartDate, data.lastYearEndDate)}.`
                      : "Whole months.") : "Pick a month."}
                  action={
                      <label style={{ display: "grid", gap: 4, gridTemplateColumns: "minmax(0, 1fr)", fontSize: 12, fontWeight: 600, color: C.text }}>
                          Month
                          <input type="month" value={month} max={currentMonthKey()} onChange={(e) => e.target.value && setMonth(e.target.value)} style={inputStyle} />
                      </label>
                  }>
                {loading && !data && <Loading label="the comparison" />}
                {error && <ErrorBox message={error} onRetry={() => setTick((t) => t + 1)} />}
                {data && (
                    <div style={{ ...grid(150), opacity: loading ? 0.6 : 1 }}>
                        <Kpi label="Units sold" value={fmt(data.totals.units)} sub={<>{fmt(data.totals.lastYearUnits)} last year · <ChangeChip change={data.totals.unitsChange} /></>} />
                        <Kpi label="Sales" value={peso(data.totals.revenue)} sub={<>{peso(data.totals.lastYearRevenue)} last year · <ChangeChip change={data.totals.revenueChange} /></>} />
                        <Kpi label="Products sold" value={fmt(data.products.filter((p) => p.units > 0).length)} sub={`${fmt(data.products.filter((p) => p.lastYearUnits > 0).length)} last year`} />
                    </div>
                )}
            </Card>

            {data && (
                <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)", opacity: loading ? 0.6 : 1 }}>
                    <div style={grid(300, 16)}>
                        <Card title="Selling more than last year"><MoverList items={data.biggestIncrease} empty="No product sold more than last year." /></Card>
                        <Card title="Selling less than last year"><MoverList items={data.biggestDecrease} empty="No product sold less than last year." /></Card>
                    </div>

                    <Card title="Categories"
                          action={
                              <span style={{ display: "inline-flex", gap: 14, fontSize: 12, color: C.text }}>
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: SERIES[0] }} />{data.label}</span>
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: SERIES[1] }} />{data.lastYearLabel}</span>
                              </span>
                          }>
                        {data.categories.length ? (
                            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr)" }}>
                                {data.categories.map((c) => (
                                    <div key={c.name} style={{ display: "grid", gridTemplateColumns: "minmax(90px, 160px) minmax(0, 1fr) auto", alignItems: "center", gap: 10, fontSize: 13 }}>
                                        <span style={{ color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.name}>{c.name}</span>
                                        <span style={{ display: "grid", gap: 3, gridTemplateColumns: "minmax(0, 1fr)" }} title={`${c.name}: ${fmt(c.units)} vs ${fmt(c.lastYearUnits)} units`}>
                                            <span style={{ height: 8, width: `${(c.units / maxUnits) * 100}%`, minWidth: c.units ? 3 : 0, background: SERIES[0], borderRadius: 4 }} />
                                            <span style={{ height: 8, width: `${(c.lastYearUnits / maxUnits) * 100}%`, minWidth: c.lastYearUnits ? 3 : 0, background: SERIES[1], borderRadius: 4 }} />
                                        </span>
                                        <span style={{ color: C.muted, whiteSpace: "nowrap", fontSize: 12 }}><strong style={{ color: C.ink }}>{fmt(c.units)}</strong> vs {fmt(c.lastYearUnits)} · <ChangeChip change={c.change} compact /></span>
                                    </div>
                                ))}
                            </div>
                        ) : <Empty>No sales in either month.</Empty>}
                    </Card>

                    <Card title="All products" sub="Click a column to sort.">
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                            <input aria-label="Search products" placeholder="Search products" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...inputStyle, flex: "1 1 200px" }} />
                            <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
                                {["All", ...data.categories.map((c) => c.name)].map((c) => <option key={c} value={c}>{c === "All" ? "All categories" : c}</option>)}
                            </select>
                        </div>
                        <div style={{ overflowX: "auto", border: `1px solid ${C.line}`, borderRadius: 12 }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 520 }}>
                                <thead>
                                <tr style={{ background: "#FFFCF7" }}>
                                    {header("name", "Product", "left")}
                                    {header("units", data.label, "right")}
                                    {header("lastYearUnits", data.lastYearLabel, "right")}
                                    {header("change", "Change", "right")}
                                </tr>
                                </thead>
                                <tbody>
                                {(showAll ? rows : rows.slice(0, 10)).map((p) => (
                                    <tr key={p.productId} style={{ borderTop: `1px solid ${C.track}` }}>
                                        <td style={{ padding: "8px 10px", color: C.ink }}>{p.name}<span style={{ display: "block", fontSize: 12, color: C.muted }}>{p.category}</span></td>
                                        <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: C.ink }}>{fmt(p.units)}</td>
                                        <td style={{ padding: "8px 10px", textAlign: "right", color: C.text }}>{fmt(p.lastYearUnits)}</td>
                                        <td style={{ padding: "8px 10px", textAlign: "right" }}><ChangeChip change={p.change} /></td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                            {!rows.length && <p style={{ padding: 12, margin: 0, fontSize: 13, color: C.muted }}>No matching products.</p>}
                        </div>
                        {rows.length > 10 && (
                            <button type="button" onClick={() => setShowAll((v) => !v)} style={{ ...buttonStyle(), marginTop: 10 }}>
                                {showAll ? "Show fewer" : `Show all ${fmt(rows.length)} products`}
                            </button>
                        )}
                    </Card>

                    {data.rentals.length > 0 && (
                        <Card title="Rental items booked">
                            <div style={grid(220)}>
                                {data.rentals.slice(0, 8).map((r) => (
                                    <div key={r.equipmentId} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 12px", fontSize: 13 }}>
                                        <p style={{ margin: 0, color: C.ink, fontWeight: 600 }}>{r.name}</p>
                                        <p style={{ margin: "4px 0 0", color: C.muted }}><strong style={{ color: C.ink }}>{fmt(r.units)}</strong> vs {fmt(r.lastYearUnits)} units · <ChangeChip change={r.change} compact /></p>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )}
                </div>
            )}
        </div>
    );
}

/* -------------------------------------------------------
 * ONE PRODUCT OR RENTAL ITEM
 * ------------------------------------------------------- */

type ItemOption = { id: number; name: string; category: string };
type ItemInsight = {
    kind: "product" | "rental"; item: ItemOption; today: string; historyStart: string;
    years: { year: number; months: (number | null)[]; total: number }[];
    calendarMonths: { month: number; label: string; average: number | null; years: number; index: number | null }[];
    bestMonths: { month: number; label: string; average: number; index: number }[];
    slowMonths: { month: number; label: string; average: number }[];
    trend: { last12: number; previous12: number; change: Change; label: string };
    thisMonth: { label: string; units: number; lastYearUnits: number; change: Change };
    hours: number[]; peakHours: { hour: number; label: string; units: number }[]; weekdays: number[]; peakWeekday: number | null;
    totals: { units: number; revenue: number };
    timeline: { date: string; sold?: number; received?: number; stock?: number; unitsOut?: number; upcoming?: boolean }[];
    stock: { onHand?: number; reserved?: number; available?: number; reorderLevel?: number; owned?: number } | null;
    insights: string[];
};

function SmallBars({ values, labels, unit, highlight, height = 90 }: { values: number[]; labels: string[]; unit: string; highlight?: (i: number) => boolean; height?: number }) {
    const max = Math.max(1, ...values);
    return (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: height + 18 }} role="img" aria-label={labels.map((l, i) => `${l}: ${fmt(values[i], 1)} ${unit}`).join(", ")}>
            {values.map((v, i) => (
                <div key={i} title={`${labels[i]}: ${fmt(v, 1)} ${unit}`} style={{ flex: 1, minWidth: 6, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <div style={{ width: "100%", height: Math.max(v > 0 ? 2 : 0, (v / max) * height), background: highlight?.(i) ? C.accent : "#CFC0E3", borderRadius: "4px 4px 0 0" }} />
                    <span style={{ fontSize: 10, color: C.muted, whiteSpace: "nowrap" }}>{labels[i]}</span>
                </div>
            ))}
        </div>
    );
}

const shortDate = (s: string) => dateText(s, false);

/** Units sold per day (bars) and stock on hand per day (line), last 90 days. */
function ProductTimeline({ timeline, reorderLevel }: { timeline: ItemInsight["timeline"]; reorderLevel?: number }) {
    const [boxRef, W] = useElementWidth<HTMLDivElement>();
    const H = 120, L = 40, R = 10, T = 10, B = 22;
    const n = timeline.length;
    if (!n) return <Empty>No stock records yet.</Empty>;
    const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, n - 1);
    const maxSold = Math.max(1, ...timeline.map((d) => d.sold || 0));
    const maxStock = Math.max(1, reorderLevel || 0, ...timeline.map((d) => d.stock || 0));
    const ys = (v: number, max: number) => T + (H - T - B) - (v / max) * (H - T - B);
    const ticks = timeline.map((d, i) => ({ d, i })).filter(({ i }) => i % 15 === 0 || i === n - 1);
    const axis = ticks.map(({ d, i }) => <text key={d.date} x={x(i)} y={H - 6} textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"} fontSize="10" fill={C.muted}>{shortDate(d.date)}</text>);
    const deliveries = timeline.filter((d) => (d.received || 0) > 0).length;
    return (
        <div ref={boxRef} style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(0, 1fr)" }}>
            <div>
                <p style={{ margin: "0 0 4px", fontSize: 12, color: C.text, fontWeight: 600 }}>Sold per day</p>
                <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }} role="img" aria-label="Units sold per day, last 90 days">
                    <line x1={L} x2={W - R} y1={ys(0, maxSold)} y2={ys(0, maxSold)} stroke="#E4DAED" />
                    <text x={L - 6} y={ys(maxSold, maxSold) + 4} textAnchor="end" fontSize="10" fill={C.muted}>{fmt(maxSold)}</text>
                    {timeline.map((d, i) => (d.sold || 0) > 0 ? (
                        <rect key={d.date} x={x(i) - 2.5} y={ys(d.sold || 0, maxSold)} width={5} height={ys(0, maxSold) - ys(d.sold || 0, maxSold)} rx={1.5} fill={SERIES[0]}>
                            <title>{`${shortDate(d.date)}: ${fmt(d.sold || 0)} sold`}</title>
                        </rect>
                    ) : null)}
                    {axis}
                </svg>
            </div>
            <div>
                <p style={{ margin: "0 0 4px", fontSize: 12, color: C.text, fontWeight: 600 }}>
                    Stock on hand{deliveries ? ` · ${deliveries} deliveries (dots)` : ""}{reorderLevel ? ` · red line = reorder level (${fmt(reorderLevel)})` : ""}
                </p>
                <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }} role="img" aria-label="Stock on hand per day, last 90 days">
                    <line x1={L} x2={W - R} y1={ys(0, maxStock)} y2={ys(0, maxStock)} stroke="#E4DAED" />
                    <text x={L - 6} y={ys(maxStock, maxStock) + 4} textAnchor="end" fontSize="10" fill={C.muted}>{fmt(maxStock)}</text>
                    {reorderLevel ? <line x1={L} x2={W - R} y1={ys(reorderLevel, maxStock)} y2={ys(reorderLevel, maxStock)} stroke={C.down} strokeDasharray="5 4" strokeWidth={1.5} /> : null}
                    <path d={timeline.map((d, i) => `${i ? "L" : "M"}${x(i)} ${ys(d.stock || 0, maxStock)}`).join(" ")} fill="none" stroke={SERIES[3]} strokeWidth={2} strokeLinejoin="round" />
                    {timeline.map((d, i) => (d.received || 0) > 0 ? (
                        <circle key={d.date} cx={x(i)} cy={ys(d.stock || 0, maxStock)} r={4} fill={SERIES[3]} stroke="#fff" strokeWidth={2}>
                            <title>{`${shortDate(d.date)}: received ${fmt(d.received || 0)}, stock ${fmt(d.stock || 0)}`}</title>
                        </circle>
                    ) : null)}
                    {axis}
                </svg>
            </div>
        </div>
    );
}

/** Units out on rent per day vs units owned (past 90 days and the next 60 days already booked). */
function RentalTimeline({ timeline, owned }: { timeline: ItemInsight["timeline"]; owned: number }) {
    const [boxRef, W] = useElementWidth<HTMLDivElement>();
    const H = 150, L = 40, R = 10, T = 10, B = 22;
    const n = timeline.length;
    if (!n) return <Empty>No rental records yet.</Empty>;
    const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, n - 1);
    const max = Math.max(1, owned, ...timeline.map((d) => d.unitsOut || 0));
    const y = (v: number) => T + (H - T - B) - (v / max) * (H - T - B);
    const todayIndex = timeline.findIndex((d) => d.upcoming);
    return (
        <div ref={boxRef}>
            <p style={{ margin: "0 0 4px", fontSize: 12, color: C.text, fontWeight: 600 }}>
                Units out per day · dashed line = units owned ({fmt(owned)}) · light bars = already booked
            </p>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }} role="img" aria-label="Rental units out per day, past 90 days and next 60 days">
                <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#E4DAED" />
                <text x={L - 6} y={y(max) + 4} textAnchor="end" fontSize="10" fill={C.muted}>{fmt(max)}</text>
                {timeline.map((d, i) => (d.unitsOut || 0) > 0 ? (
                    <rect key={d.date} x={x(i) - 2} y={y(d.unitsOut || 0)} width={4} height={y(0) - y(d.unitsOut || 0)} rx={1.5}
                          fill={(d.unitsOut || 0) > owned ? C.down : SERIES[0]} opacity={d.upcoming ? 0.45 : 1}>
                        <title>{`${shortDate(d.date)}: ${fmt(d.unitsOut || 0)} out${(d.unitsOut || 0) > owned ? " (more than owned)" : ""}`}</title>
                    </rect>
                ) : null)}
                <line x1={L} x2={W - R} y1={y(owned)} y2={y(owned)} stroke={C.ink} strokeDasharray="5 4" strokeWidth={1.5} />
                {todayIndex > 0 && <line x1={x(todayIndex) - 2} x2={x(todayIndex) - 2} y1={T} y2={H - B} stroke="#C9BCD8" />}
                {todayIndex > 0 && <text x={x(todayIndex)} y={T + 10} fontSize="10" fill={C.muted}>Today</text>}
                {timeline.map((d, i) => (i % 15 === 0 || i === n - 1) ? <text key={d.date} x={x(i)} y={H - 6} textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"} fontSize="10" fill={C.muted}>{shortDate(d.date)}</text> : null)}
            </svg>
        </div>
    );
}

function monthNames(list: { label: string }[]) {
    return list.length ? list.map((m) => m.label.slice(0, 3)).join(", ") : "–";
}

export function ItemInsightSection({ branchId, popular = [] }: { branchId: number | null; popular?: string[] }) {
    const [kind, setKind] = useState<"product" | "rental">("product");
    const [options, setOptions] = useState<{ products: ItemOption[]; equipment: ItemOption[] } | null>(null);
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const [selected, setSelected] = useState<ItemOption | null>(null);
    const [optionsError, setOptionsError] = useState("");
    // State changes only when a response arrives; the result is shown only if it is for the selected item.
    const itemKey = selected ? `${kind}|${selected.id}|${branchId ?? "all"}` : "";
    const [result, setResult] = useState<{ key: string; data: ItemInsight | null; error: string }>({ key: "", data: null, error: "" });
    const current = selected !== null && result.key === itemKey;
    const data = current ? result.data : null;
    const loading = selected !== null && !current;
    const error = optionsError || (current ? result.error : "");

    useEffect(() => {
        let cancelled = false;
        analyticsRequest<{ products: ItemOption[]; equipment: ItemOption[] }>({ action: "get_item_options" })
            .then((d) => { if (!cancelled) setOptions({ products: d.products, equipment: d.equipment }); })
            .catch((e) => { if (!cancelled) setOptionsError(e instanceof Error ? e.message : "Could not load the item list."); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!selected) return;
        let cancelled = false;
        analyticsRequest<ItemInsight>({ action: "get_item_insight", kind, item_id: selected.id, ...(branchId ? { branch_id: branchId } : {}) })
            .then((d) => { if (!cancelled) setResult({ key: itemKey, data: d, error: "" }); })
            .catch((e) => { if (!cancelled) setResult({ key: itemKey, data: null, error: e instanceof Error ? e.message : "Could not load this item." }); });
        return () => { cancelled = true; };
    }, [selected, kind, branchId, itemKey]);

    const list = (kind === "product" ? options?.products : options?.equipment) || [];
    const suggestions = (() => {
        const byName = new Map(list.map((o) => [o.name, o]));
        const top = (kind === "product" ? popular : []).map((name) => byName.get(name)).filter((o): o is ItemOption => Boolean(o));
        return (top.length ? top : list).slice(0, 4);
    })();
    const matches = query.trim() ? list.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8) : [];
    const unit = kind === "rental" ? "booked" : "sold";
    const pick = (o: ItemOption) => { setSelected(o); setQuery(""); setActive(0); };
    const switchKind = (next: "product" | "rental") => { setKind(next); setSelected(null); setQuery(""); };
    const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
        if (!matches.length) return;
        if (event.key === "ArrowDown") { event.preventDefault(); setActive((a) => Math.min(matches.length - 1, a + 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
        if (event.key === "Enter") { event.preventDefault(); pick(matches[Math.min(active, matches.length - 1)]); }
        if (event.key === "Escape") setQuery("");
    };

    return (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
            <Card title="Look up a product or rental item" sub="See how one item sold over the last three years.">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <Segmented label="Item type" value={kind} onChange={switchKind} options={[{ id: "product", label: "Products" }, { id: "rental", label: "Rental items" }]} />
                    <div style={{ position: "relative", flex: "1 1 260px", minWidth: 0 }}>
                        <input role="combobox" aria-expanded={matches.length > 0} aria-controls="item-search-list" aria-autocomplete="list"
                               aria-label={kind === "product" ? "Search a product" : "Search a rental item"} value={query}
                               onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKey}
                               placeholder={kind === "product" ? "Type a product name" : "Type a rental item name"}
                               style={{ ...inputStyle, width: "100%" }} />
                        {matches.length > 0 && (
                            <ul id="item-search-list" role="listbox" style={{ position: "absolute", zIndex: 20, left: 0, right: 0, margin: "4px 0 0", padding: 4, listStyle: "none", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, boxShadow: "0 8px 20px rgba(43,23,76,0.12)" }}>
                                {matches.map((o, i) => (
                                    <li key={o.id} role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)} onMouseEnter={() => setActive(i)}
                                        style={{ padding: "8px 10px", borderRadius: 6, fontSize: 13, color: C.ink, cursor: "pointer", background: i === active ? C.soft : "transparent" }}>
                                        {o.name} <span style={{ color: C.muted }}>· {o.category}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {query.trim() && !matches.length && options && (
                            <p style={{ margin: "6px 0 0", fontSize: 12, color: C.muted }}>No {kind === "product" ? "product" : "rental item"} matches “{query.trim()}”.</p>
                        )}
                    </div>
                </div>
                {!selected && list.length > 0 && (
                    <p style={{ margin: "10px 0 0", fontSize: 12, color: C.muted }}>
                        {kind === "product" && popular.length ? "Best sellers:" : "Try:"}{" "}
                        {suggestions.map((o) => (
                            <button key={o.id} type="button" onClick={() => pick(o)} style={{ border: `1px solid ${C.line}`, background: C.soft, borderRadius: 999, padding: "3px 10px", margin: "2px 4px 2px 0", fontSize: 12, color: C.ink, cursor: "pointer" }}>{o.name}</button>
                        ))}
                    </p>
                )}
            </Card>

            {error && <ErrorBox message={error} />}
            {loading && !data && <Loading label={selected?.name || "the item"} />}
            {data && (
                <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)", opacity: loading ? 0.6 : 1 }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.ink }}>{data.item.name}</h3>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: C.muted }}>{data.item.category} · records since {dateText(data.historyStart)}</p>
                    </div>
                    <div style={grid(150)}>
                        <Kpi label={`Units ${unit}, last 12 months`} value={fmt(data.trend.last12)}
                             sub={<>{fmt(data.trend.previous12)} the year before · <ChangeChip change={data.trend.change} /></>} />
                        <Kpi label={`${data.thisMonth.label || "This month"} so far`} value={fmt(data.thisMonth.units)}
                             sub={<>{fmt(data.thisMonth.lastYearUnits)} same days last year · <ChangeChip change={data.thisMonth.change} /></>} />
                        <Kpi label="Busiest months" value={monthNames(data.bestMonths)} sub={data.slowMonths.length ? `Slowest: ${monthNames(data.slowMonths)}` : undefined} />
                        {data.kind === "product" && data.stock
                            ? <Kpi label="Available now" value={fmt(data.stock.available || 0)} sub={`On hand ${fmt(data.stock.onHand || 0)} · reserved ${fmt(data.stock.reserved || 0)}`} />
                            : <Kpi label="Units owned" value={fmt(data.stock?.owned || 0)} sub="Can be out at the same time" />}
                    </div>
                    <Card title="Each year, month by month">
                        <LineChart ariaLabel={`Units ${unit} per month by year`} labels={MONTHS}
                                   series={[...data.years].reverse().slice(0, 4).map((yr, i) => ({ name: `${yr.year} (${fmt(yr.total)})`, color: SERIES[i], values: yr.months }))} />
                    </Card>
                    <div style={grid(300, 16)}>
                        <Card title="Usual busy months" sub="Average per calendar month. Dark bars are at least 30% above a normal month.">
                            <SmallBars unit={`${unit} on average`} values={data.calendarMonths.map((m) => m.average || 0)} labels={MONTHS}
                                       highlight={(i) => (data.calendarMonths[i].index || 0) >= 1.3} />
                        </Card>
                        {data.kind === "product" ? (
                            <Card title="Buying hours"
                                  sub={data.peakHours.length ? `Most sold around ${data.peakHours.map((p) => p.label).join(", ")}${data.peakWeekday !== null ? `. Busiest day: ${WEEKDAYS[data.peakWeekday]}.` : "."}` : "No sales yet."}>
                                {(() => {
                                    const hours = openHours([{ hours: data.hours }]);
                                    return hours.length ? (
                                        <SmallBars unit="units" values={hours.map((h) => data.hours[h])} labels={hours.map(shortHour)}
                                                   highlight={(i) => data.peakHours.some((p) => p.hour === hours[i])} />
                                    ) : <Empty>No sales yet.</Empty>;
                                })()}
                            </Card>
                        ) : (
                            <Card title="Event days" sub="Units booked by the weekday of the event.">
                                <SmallBars unit="units booked" values={data.weekdays} labels={["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]}
                                           highlight={(i) => i === data.peakWeekday} />
                            </Card>
                        )}
                    </div>
                    <Card title={data.kind === "product" ? "Stock, last 90 days" : "Rental schedule"}>
                        {data.kind === "product"
                            ? <ProductTimeline timeline={data.timeline} reorderLevel={data.stock?.reorderLevel} />
                            : <RentalTimeline timeline={data.timeline} owned={data.stock?.owned || 0} />}
                    </Card>
                </div>
            )}
        </div>
    );
}
