"use client";

/*
 * Forecasting building blocks and planning tabs.
 *   - UI pieces shared by the Forecasting page: Card, Kpi, Tabs, Segmented, Badge, Table, LineChart ...
 *   - StockPlanPanel: what the next three months need (products to stock up, rental items that may run short)
 *   - EventsPanel: the store's events (elections, holidays, fiestas) and what to prepare for the next one
 *   - AccuracyPanel: how close past forecasts were to what really sold
 *
 * Layout uses inline styles so it looks the same even if Tailwind did not generate a class.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

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
    up: "#138342",
    down: "#B3261E",
    warn: "#A56607",
    track: "#F0EAF5",
};
// Series colors in a fixed order: purple, orange, green, blue.
export const SERIES = ["#7651A5", "#eb6834", "#1baf7a", "#2a78d6"];

export const fmt = (value: number | null | undefined, digits = 0) =>
    value === null || value === undefined || !Number.isFinite(Number(value)) ? "–"
        : new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Number(value));

export const pctText = (value: number | null | undefined, digits = 0) =>
    value === null || value === undefined || !Number.isFinite(Number(value)) ? "–" : `${Number(value) > 0 ? "+" : ""}${fmt(value, digits)}%`;

export function dateText(iso: string, withYear = true) {
    const date = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

export function monthText(isoOrMonth: string) {
    const key = String(isoOrMonth || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) return isoOrMonth || "–";
    return new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export async function forecastRequest<T>(body: Record<string, unknown>): Promise<T> {
    const token = typeof window !== "undefined" ? sessionStorage.getItem("token") : null;
    if (!token) throw new Error("You are signed out. Please sign in again.");
    const response = await fetch("/api/forecasting", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) throw new Error(payload.error || "Something went wrong. Please try again.");
    return payload as T;
}

// Loads one forecasting action. State changes only when a response arrives;
// "loading" means the shown result is not for the current request yet.
function useForecast<T>(body: Record<string, unknown>) {
    const [tick, setTick] = useState(0);
    const bodyText = JSON.stringify(body);
    const requestKey = `${bodyText}|${tick}`;
    const [result, setResult] = useState<{ key: string; data: T | null; error: string }>({ key: "", data: null, error: "" });
    useEffect(() => {
        let cancelled = false;
        forecastRequest<T>(JSON.parse(bodyText))
            .then((d) => { if (!cancelled) setResult({ key: requestKey, data: d, error: "" }); })
            .catch((e) => { if (!cancelled) setResult({ key: requestKey, data: null, error: e instanceof Error ? e.message : "Could not load." }); });
        return () => { cancelled = true; };
    }, [bodyText, requestKey]);
    const reload = useCallback(() => setTick((t) => t + 1), []);
    const loading = result.key !== requestKey;
    return { data: result.data, error: loading ? "" : result.error, loading, reload };
}

/* -------------------------------------------------------
 * UI PIECES
 * ------------------------------------------------------- */

export const grid = (min: number, gap = 12): CSSProperties => ({
    display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap,
});
export const stack = (gap = 16): CSSProperties => ({ display: "grid", gap, gridTemplateColumns: "minmax(0, 1fr)" });

export const inputStyle: CSSProperties = {
    border: `1px solid ${C.line}`, borderRadius: 10, background: "#fff", padding: "8px 10px",
    fontSize: 13, color: C.ink, minWidth: 0, height: 38, boxSizing: "border-box",
};

export const buttonStyle = (primary = false): CSSProperties => ({
    border: `1px solid ${primary ? C.ink : C.line}`, background: primary ? C.ink : "#fff", color: primary ? "#fff" : C.ink,
    borderRadius: 10, padding: "0 14px", height: 36, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
});

export function Card({ title, sub, action, children, style }: {
    title?: ReactNode; sub?: ReactNode; action?: ReactNode; children?: ReactNode; style?: CSSProperties;
}) {
    return (
        <section style={{ border: `1px solid ${C.line}`, borderRadius: 14, background: "#fff", padding: 16, minWidth: 0, ...style }}>
            {(title || action) && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: children ? 12 : 0 }}>
                    <div style={{ minWidth: 0 }}>
                        {title && <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.ink }}>{title}</h3>}
                        {sub && <div style={{ margin: "3px 0 0", fontSize: 12, lineHeight: "18px", color: C.muted }}>{sub}</div>}
                    </div>
                    {action}
                </div>
            )}
            {children}
        </section>
    );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "warn" | "down" | "up" }) {
    const color = tone === "warn" ? C.warn : tone === "down" ? C.down : tone === "up" ? C.up : C.ink;
    return (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, background: "#fff", padding: "14px 16px", minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.muted }}>{label}</p>
            <p style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 700, color, lineHeight: 1.2, overflowWrap: "anywhere" }}>{value}</p>
            {sub && <div style={{ margin: "6px 0 0", fontSize: 12, color: C.muted, lineHeight: "18px" }}>{sub}</div>}
        </div>
    );
}

export function Badge({ tone, children }: { tone: "red" | "amber" | "green" | "purple" | "gray" | "blue"; children: ReactNode }) {
    const t = {
        red: ["#FFF0F0", "#F2C4C4", "#B3261E"], amber: ["#FFF8E8", "#F4D79A", "#8A5A06"], green: ["#EDFBF1", "#B7E9C8", "#138342"],
        purple: ["#F4EEFC", "#D9C7F0", "#4E2C66"], gray: ["#FBF9FD", C.line, "#6B5B78"], blue: ["#F1F8FF", "#D8E7F7", "#2A5F96"],
    }[tone];
    return (
        <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 999, border: `1px solid ${t[1]}`, background: t[0], color: t[2],
            padding: "2px 9px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{children}</span>
    );
}

/** ▲ 12% (green), ▼ 8% (red). */
export function Trend({ value, digits }: { value: number | null | undefined; digits?: number }) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return <span style={{ color: C.muted }}>–</span>;
    const places = digits ?? (Math.abs(Number(value)) < 10 ? 1 : 0);
    const v = Math.round(Number(value) * 10 ** places) / 10 ** places;
    const color = v > 0 ? C.up : v < 0 ? C.down : C.muted;
    return (
        <span style={{ color, fontWeight: 600, whiteSpace: "nowrap" }}>
            {v !== 0 && <span aria-hidden style={{ fontSize: 10, marginRight: 3 }}>{v > 0 ? "▲" : "▼"}</span>}
            <span style={{ position: "absolute", left: -9999 }}>{v > 0 ? "up " : v < 0 ? "down " : ""}</span>
            {fmt(Math.abs(v), places)}%
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
    return <div role="status" style={{ border: `1px solid ${C.line}`, borderRadius: 14, background: "#fff", padding: 18, textAlign: "center", fontSize: 13, color: C.muted }}>Loading {label}…</div>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
        <div role="alert" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, border: "1px solid #F2C4C4", background: "#FFF6F6", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: "#8E2D2D" }}>
            <span>{message}</span>
            {onRetry && <button type="button" onClick={onRetry} style={buttonStyle()}>Try again</button>}
        </div>
    );
}

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

type Align = "left" | "right";
// First column left, the rest right (numbers), unless a column is listed as text.
const alignOf = (i: number, textCols: number[]): Align => (i === 0 || textCols.includes(i) ? "left" : "right");

export function Table({ head, children, minWidth = 640, textCols = [] }: { head: ReactNode[]; children: ReactNode; minWidth?: number; textCols?: number[] }) {
    return (
        <div style={{ overflowX: "auto", border: `1px solid ${C.line}`, borderRadius: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth }}>
                <thead style={{ background: "#FFFCF7" }}>
                <tr>{head.map((h, i) => <th key={i} scope="col" style={{ textAlign: alignOf(i, textCols), padding: "9px 10px", fontSize: 12, fontWeight: 600, color: C.muted, whiteSpace: "nowrap" }}>{h}</th>)}</tr>
                </thead>
                <tbody>{children}</tbody>
            </table>
        </div>
    );
}

export function Row({ cells, textCols = [] }: { cells: ReactNode[]; textCols?: number[] }) {
    return <tr style={{ borderTop: `1px solid ${C.track}` }}>{cells.map((c, i) => <td key={i} style={{ padding: "9px 10px", fontSize: 13, color: C.text, verticalAlign: "top", textAlign: alignOf(i, textCols) }}>{c}</td>)}</tr>;
}

export function ItemName({ name, detail }: { name: string; detail?: string }) {
    return <span><strong style={{ color: C.ink, fontWeight: 600 }}>{name}</strong>{detail && <span style={{ display: "block", fontSize: 12, color: C.muted }}>{detail}</span>}</span>;
}

export function ShowMore({ total, shown, onToggle, label }: { total: number; shown: number; onToggle: () => void; label: string }) {
    if (total <= shown && shown <= 10) return null;
    if (total <= 10) return null;
    return <button type="button" onClick={onToggle} style={{ ...buttonStyle(), marginTop: 10 }}>{shown < total ? `Show all ${fmt(total)} ${label}` : "Show fewer"}</button>;
}

export function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" onClick={onClick} style={{ border: 0, background: "transparent", padding: 0, color: C.accent, fontSize: 13, fontWeight: 600, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}>
            {children}
        </button>
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

/** Line chart with a hover readout. Every series has one value per label. */
export function LineChart({ labels, series, format = (v) => fmt(v), height = 240, ariaLabel }: {
    labels: string[];
    series: { name: string; color: string; values: (number | null)[]; dashed?: boolean }[];
    format?: (value: number) => string;
    height?: number;
    ariaLabel: string;
}) {
    const [hover, setHover] = useState<number | null>(null);
    const [boxRef, W] = useElementWidth<HTMLDivElement>();
    if (!labels.length) return <Empty>Nothing to show yet.</Empty>;
    const H = height, L = 52, R = 20, T = 14, B = 30;
    const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => v || 0)));
    const step = labels.length > 1 ? (W - L - R) / (labels.length - 1) : 0;
    const x = (i: number) => (labels.length > 1 ? L + i * step : (L + W - R) / 2);
    const y = (v: number) => T + (H - T - B) - (Math.max(0, v) / max) * (H - T - B);
    const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor((W - L - R) / 48))));
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
                            <text x={L - 8} y={y(max * t) + 4} textAnchor="end" fontSize="11" fill={C.muted}>{fmt(max * t)}</text>
                        </g>
                    ))}
                    {labels.map((label, i) => (i % every === 0 || i === labels.length - 1) && (
                        <text key={i} x={x(i)} y={H - 10} textAnchor={labels.length > 1 && i === labels.length - 1 ? "end" : labels.length > 1 && i === 0 ? "start" : "middle"} fontSize="11" fill={C.muted}>{label}</text>
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
 * STOCK PLAN
 * ------------------------------------------------------- */

type PlanMonth = { month: string; label: string; expected: number; lastYear: number; index: number; prepare?: number; addBefore?: number };
type StockPlan = {
    today: string; months: { month: string; label: string }[]; historyFrom: string; historyTo: string; historyMonths: number; canViewStock: boolean;
    monthSummary: { month: string; label: string; expectedUnits: number; normalUnits: number; ratio: number; topRising: string[] }[];
    products: { branchId: number; branchName: string; productId: number; name: string; category: string; normalMonth: number;
        available: number | null; months: PlanMonth[]; peakMonth: string; peakIndex: number; extraUnits: number; limitedHistory: boolean }[];
    risingProducts: number; trackedProducts: number;
    rentals: { branchId: number; branchName: string; equipmentId: number; name: string; category: string; growth: number; owned: number | null;
        months: { month: string; label: string; expectedPeakDay: number; alreadyBookedPeakDay: number; need: number; shortage?: number }[];
        busiestMonth: string; status: "SHORT" | "TIGHT" | "OK" | null }[];
    rentalShortages: number; method: string;
};

const monthShort = (label: string) => label.split(" ")[0].slice(0, 3);

export function StockPlanPanel({ branchId }: { branchId: number | null }) {
    const { data, error, loading, reload } = useForecast<StockPlan>({ action: "get_seasonal_stock_plan", ...(branchId ? { branch_id: branchId } : {}) });
    const [allProducts, setAllProducts] = useState(false);
    const [allRentals, setAllRentals] = useState(false);
    if (loading && !data) return <Loading label="the stock plan" />;
    if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
    if (!data) return null;
    const products = allProducts ? data.products : data.products.slice(0, 10);
    const rentals = allRentals ? data.rentals : data.rentals.slice(0, 10);
    const multiBranch = new Set([...data.products.map((p) => p.branchId), ...data.rentals.map((r) => r.branchId)]).size > 1;
    const toOrder = data.products.filter((p) => p.months.some((m) => (m.addBefore || 0) > 0)).length;
    return (
        <div style={{ ...stack(), opacity: loading ? 0.6 : 1 }}>
            <Card title={`Next ${data.months.length} months`}
                  sub={<>Based on {fmt(data.historyMonths)} months of sales ({monthText(data.historyFrom)} – {monthText(data.historyTo)}).{" "}
                      <details style={{ display: "inline" }}><summary style={{ display: "inline", cursor: "pointer", color: C.accent, fontWeight: 600 }}>How this works</summary>
                          <span style={{ display: "block", marginTop: 6, color: C.text }}>{data.method}</span></details></>}>
                <div style={grid(150)}>
                    {data.monthSummary.map((m) => {
                        const busier = m.ratio >= 1.1, slower = m.ratio <= 0.9;
                        return (
                            <div key={m.month} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", background: busier ? "#FFFBF2" : "#fff" }}>
                                <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.muted }}>{m.label}</p>
                                <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 700, color: C.ink }}>{fmt(m.expectedUnits)} units</p>
                                <p style={{ margin: "2px 0 0", fontSize: 12, fontWeight: 600, color: busier ? C.warn : slower ? "#2A5F96" : C.text }}>
                                    {busier ? `${fmt((m.ratio - 1) * 100)}% busier than usual` : slower ? `${fmt((1 - m.ratio) * 100)}% quieter than usual` : "About usual"}
                                </p>
                                {m.topRising.length > 0 && <p style={{ margin: "6px 0 0", fontSize: 12, color: C.muted }}>Selling more: {m.topRising.slice(0, 3).join(", ")}</p>}
                            </div>
                        );
                    })}
                </div>
            </Card>

            <Card title="Products to stock up"
                  sub={<>Products that sell at least 30% more in one of these months ({fmt(data.risingProducts)} of {fmt(data.trackedProducts)}).
                      {data.canViewStock ? <> “Add before” is how many to add before that month starts.{toOrder ? <> <strong style={{ color: C.down }}>{fmt(toOrder)} need an order.</strong></> : ""}</> : ""}</>}>
                {data.products.length ? (
                    <Table minWidth={data.canViewStock ? 880 : 640}
                           head={["Product", "Usual month", ...data.months.map((m) => monthShort(m.label)), ...(data.canViewStock ? ["In stock", ...data.months.map((m) => `Add before ${monthShort(m.label)}`)] : [])]}>
                        {products.map((p) => (
                            <Row key={`${p.branchId}:${p.productId}`} cells={[
                                <ItemName key="n" name={p.name} detail={`${p.category}${multiBranch ? ` · ${p.branchName}` : ""}`} />,
                                fmt(p.normalMonth),
                                ...p.months.map((m) => (
                                    <span key={m.month} title={`Last year: ${fmt(m.lastYear)} · ${fmt(m.index, 1)}× a usual month`}>
                                        <strong style={{ color: m.index >= 1.3 ? C.warn : C.ink }}>{fmt(m.expected)}</strong>
                                        <span style={{ display: "block", fontSize: 12, color: C.muted }}>last yr {fmt(m.lastYear)}</span>
                                    </span>
                                )),
                                ...(data.canViewStock ? [fmt(p.available), ...p.months.map((m) => (m.addBefore || 0) > 0
                                    ? <strong key={m.month} style={{ color: C.down }}>+{fmt(m.addBefore)}</strong> : <span key={m.month} style={{ color: C.muted }}>–</span>)] : []),
                            ]} />
                        ))}
                    </Table>
                ) : <Empty>No product is expected to sell much more than usual in these months.</Empty>}
                <ShowMore total={data.products.length} shown={products.length} onToggle={() => setAllProducts((v) => !v)} label="products" />
            </Card>

            <Card title="Rental items"
                  sub={<>Units needed on the busiest day of each month, from past years or bookings already made (whichever is higher).
                      {data.canViewStock ? (data.rentalShortages ? <> <strong style={{ color: C.down }}>{fmt(data.rentalShortages)} may run short.</strong></> : " None should run short.") : ""}</>}>
                {data.rentals.length ? (
                    <Table minWidth={720} head={["Rental item", ...(data.canViewStock ? ["Units owned"] : []), ...data.months.map((m) => monthShort(m.label)), ...(data.canViewStock ? ["Status"] : [])]}>
                        {rentals.map((r) => (
                            <Row key={`${r.branchId}:${r.equipmentId}`} cells={[
                                <ItemName key="n" name={r.name} detail={`${r.category}${multiBranch ? ` · ${r.branchName}` : ""}`} />,
                                ...(data.canViewStock ? [fmt(r.owned)] : []),
                                ...r.months.map((m) => (
                                    <span key={m.month} title={`Expected ${fmt(m.expectedPeakDay)} · already booked ${fmt(m.alreadyBookedPeakDay)}`}>
                                        <strong style={{ color: (m.shortage || 0) > 0 ? C.down : C.ink }}>{fmt(m.need)}</strong>
                                        <span style={{ display: "block", fontSize: 12, color: C.muted }}>booked {fmt(m.alreadyBookedPeakDay)}</span>
                                    </span>
                                )),
                                ...(data.canViewStock ? [r.status === "SHORT" ? <Badge key="s" tone="red">Short</Badge> : r.status === "TIGHT" ? <Badge key="s" tone="amber">Tight</Badge> : <Badge key="s" tone="green">Enough</Badge>] : []),
                            ]} />
                        ))}
                    </Table>
                ) : <Empty>No rental bookings are expected in these months.</Empty>}
                <ShowMore total={data.rentals.length} shown={rentals.length} onToggle={() => setAllRentals((v) => !v)} label="rental items" />
            </Card>
        </div>
    );
}

/* -------------------------------------------------------
 * EVENTS
 * ------------------------------------------------------- */

type StoreEvent = { id: number; branchId: number | null; branchName: string | null; name: string; type: string; startDate: string; endDate: string;
    notes: string | null; status: "past" | "ongoing" | "upcoming" };
type EventList = { canEdit: boolean; types: string[]; events: StoreEvent[]; today: string };
type EventForecast = {
    event: StoreEvent & { days: number; startsIn: number; label: string };
    ready: boolean; message?: string;
    learnedFrom?: StoreEvent & { label: string; comparedWith: string };
    growth?: number; salesLift?: number | null;
    products?: { productId: number; name: string; category: string; pastUnits: number; normalUnits: number; extraUnits: number; lift: number | null; expected: number; available: number | null; prepare: number | null }[];
    rentals?: { equipmentId: number; name: string; pastUnits: number; normalUnits: number; extraUnits: number; lift: number | null; expected: number; owned: number | null }[];
    bookingTypes?: { eventType: string; bookings: number; normal: number }[];
    findings?: string[];
};

const TYPE_LABEL: Record<string, string> = { election: "Election", holiday: "Holiday", school: "School season", local_event: "Fiesta / local event", promotion: "Sale / promotion", other: "Other" };
const timesUsual = (lift: number | null) => (lift === null ? "New" : `${fmt(lift, 1)}×`);

function EventForm({ initial, types, onSaved, onCancel }: { initial: Partial<StoreEvent>; types: string[]; onSaved: () => void; onCancel: () => void }) {
    const [name, setName] = useState(initial.name || "");
    const [type, setType] = useState(initial.type || "other");
    const [start, setStart] = useState(initial.startDate || "");
    const [end, setEnd] = useState(initial.endDate || "");
    const [notes, setNotes] = useState(initial.notes || "");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const save = async () => {
        if (!name.trim() || !start || !end) { setError("Enter a name, a start date and an end date."); return; }
        if (end < start) { setError("The end date must be on or after the start date."); return; }
        setSaving(true); setError("");
        try {
            await forecastRequest({ action: "save_store_event", ...(initial.id ? { id: initial.id } : {}), name: name.trim(), type, start_date: start, end_date: end, notes });
            onSaved();
        } catch (e) { setError(e instanceof Error ? e.message : "The event could not be saved."); }
        finally { setSaving(false); }
    };
    const label: CSSProperties = { display: "grid", gap: 4, fontSize: 12, fontWeight: 600, color: C.text };
    return (
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ ...stack(10), border: `1px solid ${C.line}`, borderRadius: 12, background: C.soft, padding: 14 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.ink }}>{initial.id ? "Edit event" : "Add an event"}</p>
            <div style={grid(170, 10)}>
                <label style={label}>Name<input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Town Fiesta" required /></label>
                <label style={label}>Type<select style={inputStyle} value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}</select></label>
                <label style={label}>Starts<input style={inputStyle} type="date" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
                <label style={label}>Ends<input style={inputStyle} type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} required /></label>
            </div>
            <label style={label}>Notes (optional)<input style={inputStyle} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. campaign rallies every weekend" /></label>
            <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Use the same name every year so the forecast can learn from the last one. For an election, start on the first day of the campaign.</p>
            {error && <ErrorBox message={error} />}
            <div style={{ display: "flex", gap: 8 }}>
                <button type="submit" style={buttonStyle(true)} disabled={saving}>{saving ? "Saving…" : "Save event"}</button>
                <button type="button" style={buttonStyle()} onClick={onCancel}>Cancel</button>
            </div>
        </form>
    );
}

function EventCard({ f, canViewStock, onOpenStockPlan, open, onToggle }: { f: EventForecast; canViewStock: boolean; onOpenStockPlan?: () => void; open: boolean; onToggle: () => void }) {
    const [showAll, setShowAll] = useState(false);
    const products = f.products || [];
    const shown = showAll ? products : products.slice(0, 8);
    const rentals = f.rentals || [];
    const toPrepare = products.filter((p) => (p.prepare || 0) > 0).length;
    const summary = !f.ready ? "Needs a past event to learn from"
        : [f.salesLift !== null && f.salesLift !== undefined ? `Sales ${pctText(f.salesLift)} last time` : "", canViewStock ? `${fmt(toPrepare)} product${toPrepare === 1 ? "" : "s"} to prepare` : ""].filter(Boolean).join(" · ");
    return (
        <Card title={f.event.name}
              sub={`${TYPE_LABEL[f.event.type] || f.event.type} · ${f.event.label} (${fmt(f.event.days)} days)${open ? "" : ` · ${summary}`}`}
              action={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <Badge tone={f.event.startsIn <= 30 ? "amber" : "purple"}>{f.event.startsIn <= 0 ? "Happening now" : f.event.startsIn === 1 ? "Starts tomorrow" : `Starts in ${fmt(f.event.startsIn)} days`}</Badge>
                      <button type="button" onClick={onToggle} aria-expanded={open} style={{ ...buttonStyle(), height: 30, padding: "0 10px" }}>{open ? "Hide plan" : "Show plan"}</button>
                  </span>
              }>
            {!open ? null : !f.ready ? <Empty>{f.message || "No past event to learn from yet. Add the last one in the calendar below."}</Empty> : (
                <div style={stack(14)}>
                    <div style={grid(150)}>
                        <Kpi label="Based on" value={<span style={{ fontSize: 16 }}>{f.learnedFrom?.name || "–"}</span>} sub={f.learnedFrom?.label} />
                        <Kpi label="Sales last time" value={f.salesLift === null || f.salesLift === undefined ? "–" : pctText(f.salesLift)} sub="vs usual days" tone={(f.salesLift || 0) > 0 ? "up" : undefined} />
                        <Kpi label="Store growth since" value={f.growth ? pctText((f.growth - 1) * 100) : "–"} sub="Expected amounts include this" />
                        {canViewStock && <Kpi label="Products to prepare" value={fmt(toPrepare)} sub={toPrepare ? "Not enough in stock" : "Stock is enough"} tone={toPrepare ? "down" : undefined} />}
                    </div>
                    {products.length > 0 && (
                        <div>
                            <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 700, color: C.ink }}>Products that sold more last time</p>
                            <Table minWidth={canViewStock ? 760 : 560} head={["Product", "Last time", "Usual", "× usual", "Expected", ...(canViewStock ? ["In stock", "Prepare"] : [])]}>
                                {shown.map((p) => (
                                    <Row key={p.productId} cells={[
                                        <ItemName key="n" name={p.name} detail={p.category} />,
                                        fmt(p.pastUnits), fmt(p.normalUnits), <strong key="j" style={{ color: C.warn }}>{timesUsual(p.lift)}</strong>, <strong key="e" style={{ color: C.ink }}>{fmt(p.expected)}</strong>,
                                        ...(canViewStock ? [fmt(p.available), (p.prepare || 0) > 0 ? <strong key="p" style={{ color: C.down }}>+{fmt(p.prepare)}</strong> : <span key="p" style={{ color: C.muted }}>–</span>] : []),
                                    ]} />
                                ))}
                            </Table>
                            <ShowMore total={products.length} shown={shown.length} onToggle={() => setShowAll((v) => !v)} label="products" />
                        </div>
                    )}
                    {rentals.length > 0 && (
                        <div>
                            <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 700, color: C.ink }}>Rental items booked more last time</p>
                            <Table minWidth={600} head={["Rental item", "Last time", "Usual", "× usual", "Expected", ...(canViewStock ? ["Units owned"] : [])]}>
                                {rentals.map((r) => (
                                    <Row key={r.equipmentId} cells={[<ItemName key="n" name={r.name} />, fmt(r.pastUnits), fmt(r.normalUnits),
                                        <strong key="j" style={{ color: C.warn }}>{timesUsual(r.lift)}</strong>, <strong key="e" style={{ color: C.ink }}>{fmt(r.expected)}</strong>, ...(canViewStock ? [fmt(r.owned)] : [])]} />
                                ))}
                            </Table>
                            <p style={{ margin: "6px 0 0", fontSize: 12, color: C.muted }}>
                                Totals for the whole event.{onOpenStockPlan && <> For the busiest single day, see the <LinkButton onClick={onOpenStockPlan}>stock plan</LinkButton>.</>}
                            </p>
                        </div>
                    )}
                    {(f.bookingTypes || []).length > 0 && (
                        <p style={{ margin: 0, fontSize: 13, color: C.text }}>
                            More bookings than usual last time: {(f.bookingTypes || []).map((t) => `${t.eventType} (${fmt(t.bookings)}, usually ${fmt(t.normal)})`).join(", ")}.
                        </p>
                    )}
                </div>
            )}
        </Card>
    );
}

export function EventsPanel({ branchId, canViewInventory, onOpenStockPlan }: { branchId: number | null; canViewInventory: boolean; onOpenStockPlan?: () => void }) {
    const list = useForecast<EventList>({ action: "list_store_events" });
    const forecast = useForecast<{ events: EventForecast[] }>({ action: "get_event_forecast", ...(branchId ? { branch_id: branchId } : {}) });
    const [editing, setEditing] = useState<Partial<StoreEvent> | null>(null);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState("");
    const [allPast, setAllPast] = useState(false);
    // The next event is open at first; -1 means all closed.
    const [openId, setOpenId] = useState<number | null>(null);
    const reloadAll = () => { setEditing(null); list.reload(); forecast.reload(); };
    const remove = async (e: StoreEvent) => {
        if (!window.confirm(`Delete "${e.name}" (${dateText(e.startDate)})? This cannot be undone.`)) return;
        setBusy(true); setActionError("");
        try { await forecastRequest({ action: "delete_store_event", id: e.id }); reloadAll(); }
        catch (err) { setActionError(err instanceof Error ? err.message : "The event could not be deleted."); }
        finally { setBusy(false); }
    };
    return (
        <div style={stack()}>
            {forecast.loading && !forecast.data && <Loading label="upcoming events" />}
            {forecast.error && <ErrorBox message={forecast.error} onRetry={forecast.reload} />}
            {forecast.data && (forecast.data.events.length
                ? forecast.data.events.map((f, i) => (
                    <EventCard key={f.event.id} f={f} canViewStock={canViewInventory} onOpenStockPlan={onOpenStockPlan}
                               open={openId === null ? i === 0 : openId === f.event.id}
                               onToggle={() => setOpenId((current) => ((current === null ? i === 0 : current === f.event.id) ? -1 : f.event.id))} />
                ))
                : <Empty>No events coming up. Add one in the calendar below to get a plan for it.</Empty>)}

            <Card title="Event calendar" sub="Past events teach the forecast. Upcoming events get a plan above."
                  action={list.data?.canEdit && !editing ? <button type="button" style={buttonStyle(true)} onClick={() => setEditing({})}>Add event</button> : undefined}>
                <div style={stack(12)}>
                    {editing && list.data && <EventForm initial={editing} types={list.data.types} onSaved={reloadAll} onCancel={() => setEditing(null)} />}
                    {actionError && <ErrorBox message={actionError} />}
                    {list.loading && !list.data && <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Loading events…</p>}
                    {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
                    {list.data && (list.data.events.length ? (() => {
                        const coming = list.data.events.filter((e) => e.status !== "past").sort((a, b) => a.startDate.localeCompare(b.startDate));
                        const past = list.data.events.filter((e) => e.status === "past").sort((a, b) => b.startDate.localeCompare(a.startDate));
                        const rows = [...coming, ...(allPast ? past : past.slice(0, 4))];
                        return (<>
                            <Table minWidth={620} textCols={[1, 2, 3]} head={["Event", "Type", "Dates", "Status", ...(list.data.canEdit ? [""] : [])]}>
                                {rows.map((e) => (
                                    <Row key={e.id} textCols={[1, 2, 3]} cells={[
                                        <ItemName key="n" name={e.name} detail={e.branchName || undefined} />,
                                        TYPE_LABEL[e.type] || e.type,
                                        <span key="d" style={{ whiteSpace: "nowrap" }}>{dateText(e.startDate)} – {dateText(e.endDate)}</span>,
                                        e.status === "upcoming" ? <Badge key="s" tone="purple">Upcoming</Badge> : e.status === "ongoing" ? <Badge key="s" tone="amber">Now</Badge> : <Badge key="s" tone="gray">Past</Badge>,
                                        ...(list.data!.canEdit ? [
                                            <span key="a" style={{ display: "inline-flex", gap: 6 }}>
                                            <button type="button" style={{ ...buttonStyle(), height: 30, padding: "0 10px" }} disabled={busy} onClick={() => setEditing(e)} aria-label={`Edit ${e.name}`}>Edit</button>
                                            <button type="button" style={{ ...buttonStyle(), height: 30, padding: "0 10px", color: C.down }} disabled={busy} onClick={() => void remove(e)} aria-label={`Delete ${e.name}`}>Delete</button>
                                        </span>,
                                        ] : []),
                                    ]} />
                                ))}
                            </Table>
                            {past.length > 4 && (
                                <button type="button" onClick={() => setAllPast((v) => !v)} style={{ ...buttonStyle(), justifySelf: "start" }}>
                                    {allPast ? "Show fewer past events" : `Show all ${fmt(past.length)} past events`}
                                </button>
                            )}
                        </>);
                    })() : <Empty>No events yet.</Empty>)}
                </div>
            </Card>
        </div>
    );
}

/* -------------------------------------------------------
 * FORECAST ACCURACY
 * ------------------------------------------------------- */

type Metrics = { mae: number | null; rmse: number | null; wape: number | null; accuracy: number | null; bias: number | null; comparisons: number };
type Accuracy = {
    testMonths: { month: string; label: string }[];
    methods: { shortTerm: Metrics & { name: string }; seasonal: Metrics & { name: string } };
    better: "seasonal" | "shortTerm" | null;
    levels: { level: string; label: string; shortTerm: Metrics; seasonal: Metrics }[];
    perMonth: { month: string; label: string; actual: number; shortTerm: number; seasonal: number }[];
    examples: { key: string; actual: number; shortTerm: number; seasonal: number }[];
    method: string;
};

const METHOD_LABEL = { seasonal: "Stock plan", shortTerm: "Product demand" } as const;

export function AccuracyPanel({ branchId }: { branchId: number | null }) {
    const { data, error, loading, reload } = useForecast<Accuracy>({ action: "get_forecast_accuracy", ...(branchId ? { branch_id: branchId } : {}) });
    if (loading && !data) return <Loading label="forecast accuracy" />;
    if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
    if (!data) return null;
    const total = data.levels.find((l) => l.level === "total");
    const pct = (v: number | null) => (v === null ? "–" : `${fmt(v, 1)}%`);
    const biasText = (v: number | null) => (v === null ? "" : Math.abs(v) < 0.5 ? "No lean either way" : v > 0 ? `Usually ${fmt(v, 0)}% too high` : `Usually ${fmt(-v, 0)}% too low`);
    const first = data.testMonths[0]?.label, last = data.testMonths[data.testMonths.length - 1]?.label;
    return (
        <div style={{ ...stack(), opacity: loading ? 0.6 : 1 }}>
            <Card title="How close the forecasts were"
                  sub={<>Each month from {first} to {last} was forecast using only the sales before it, then checked against what really sold.{" "}
                      <details style={{ display: "inline" }}><summary style={{ display: "inline", cursor: "pointer", color: C.accent, fontWeight: 600 }}>How this works</summary>
                          <span style={{ display: "block", marginTop: 6, color: C.text }}>{data.method}</span></details></>}>
                {total ? (
                    <div style={grid(150)}>
                        {(["seasonal", "shortTerm"] as const).map((k) => (
                            <Kpi key={k} label={`${METHOD_LABEL[k]} forecast`} value={`${pct(total[k].accuracy)} accurate`}
                                 sub={<>{biasText(total[k].bias)}{data.better === k && <> · <Badge tone="green">More accurate</Badge></>}</>} />
                        ))}
                    </div>
                ) : <Empty>Not enough sales history to test the forecasts yet.</Empty>}
            </Card>
            <Card title="Forecast vs what sold" sub="Total units each month.">
                <LineChart ariaLabel="Units sold compared with the two forecasts" labels={data.perMonth.map((r) => monthShort(r.label))}
                           series={[
                               { name: "Sold", color: SERIES[0], values: data.perMonth.map((r) => r.actual) },
                               { name: "Stock plan forecast", color: SERIES[2], values: data.perMonth.map((r) => r.seasonal) },
                               { name: "Product demand forecast", color: SERIES[1], values: data.perMonth.map((r) => r.shortTerm), dashed: true },
                           ]} />
            </Card>
            <details style={{ border: `1px solid ${C.line}`, borderRadius: 14, background: "#fff", padding: "12px 16px" }}>
                <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 700, color: C.ink }}>Accuracy by level</summary>
                <p style={{ margin: "8px 0 10px", fontSize: 12, color: C.muted }}>Single products sell only a few units a month, so their forecasts miss by more. Plan with totals and categories; use product numbers as a guide.</p>
                <Table minWidth={700} head={["Level", "Stock plan", "Off by (avg)", "Product demand", "Off by (avg)"]}>
                    {data.levels.map((l) => (
                        <Row key={l.level} cells={[<strong key="n" style={{ color: C.ink }}>{l.label}</strong>,
                            <strong key="a" style={{ color: C.ink }}>{pct(l.seasonal.accuracy)}</strong>, `${fmt(l.seasonal.mae, 1)} units`,
                            <strong key="b" style={{ color: C.ink }}>{pct(l.shortTerm.accuracy)}</strong>, `${fmt(l.shortTerm.mae, 1)} units`]} />
                    ))}
                </Table>
                <p style={{ margin: "8px 0 0", fontSize: 12, color: C.muted }}>Accuracy = 100% minus (total units off ÷ total units sold). “Off by” is the average miss per forecast (MAE).</p>
            </details>
        </div>
    );
}
