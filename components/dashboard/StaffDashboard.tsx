"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { AlertTriangle, Box, CalendarClock, ClipboardCheck, CornerUpLeft, ChevronRight, RefreshCw } from "lucide-react";

type RecordData = Record<string, unknown>;
type TaskStatus = "Need to Prepare" | "For Release" | "Expected Return";
type Task = { key: string; reference: string; customer: string; activity: "Prepare" | "Release" | "Return"; status: TaskStatus };
type Alert = { key: string; product: string; available: number; status: "Low Stock" | "Out of Stock" | "Low Availability" | "Fully Booked" | "Unavailable" };
type DashboardData = { scope: string; sales: unknown[] | null; allocations: unknown[] | null; equipment: unknown[] | null; products: unknown[] | null; errors: string[] };
const cardClass = "min-w-0 overflow-hidden rounded-2xl border border-[#E6DDF0] bg-white shadow-sm";
const headerClass = "flex flex-wrap items-center justify-between gap-3 border-b border-[#EEE7F2] px-4 py-3.5";
const iconClass = "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]";
const tableHeader = "bg-[#FFFCF7] text-[10px] font-semibold uppercase tracking-[0.04em] text-[#806A8C]";
const linkClass = "inline-flex items-center gap-1 rounded-xl border border-[#E6DDF0] bg-white px-3 py-2 text-[12px] font-semibold text-[#6D35D4] transition hover:bg-[#F7F1FF]";
const fmtInt = (value: number) => value.toLocaleString("en-PH");
function record(value: unknown): RecordData { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordData : {}; }
function str(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value).trim() : ""; }
function count(value: unknown): number | null { if (value === null || value === undefined || value === "" || typeof value === "boolean") return null; const n = Number(value); return Number.isSafeInteger(n) && n >= 0 ? n : null; }
function saved(key: string) { return typeof window === "undefined" ? "" : sessionStorage.getItem(key) || localStorage.getItem(key) || ""; }
function manilaDay(value: Date): string { const parts = new Intl.DateTimeFormat("en-US", {timeZone:"Asia/Manila", year:"numeric", month:"2-digit", day:"2-digit"}).formatToParts(value); const part = (key: string) => parts.find(p=>p.type===key)?.value || ""; return `${part("year")}-${part("month")}-${part("day")}`; }
function day(value: unknown): string { const s = str(value); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0,10) : ""; }
function clock(value: Date) { return `${value.toLocaleDateString("en-US",{timeZone:"Asia/Manila",month:"long",day:"numeric",year:"numeric"})} | ${value.toLocaleTimeString("en-US",{timeZone:"Asia/Manila",hour:"numeric",minute:"2-digit",hour12:true}).toLowerCase()}`; }
function isDenied(user: RecordData, kind: "bookings" | "inventory") { const permissions = record(user.permissions); const keys = kind === "bookings" ? ["bookings_access","booking_access","bookings","booking"] : ["inventory_access","inventory"]; const value = keys.map(k=>permissions[k]).find(v=>v!==undefined && v!==null); return value===false || value===0 || ["none","false","no","0","denied","disabled"].includes(str(value).toLowerCase()); }

// Use physical preparation/issue flags from the two existing Staff queues, not the booking lifecycle status.
// A mixed booking is counted once per due activity across both queues. Preparation takes priority over release.
function buildTasks(sales: unknown[], rentals: unknown[], today: string): Task[] {
    type Group = { reference: string; customer: string; unprepared: boolean; prepared: boolean; returning: boolean };
    const groups = new Map<string,Group>();
    const group = (reference: string, customer: string) => {
        let existing = groups.get(reference);
        if (!existing) { existing = {reference,customer:customer || "—",unprepared:false,prepared:false,returning:false}; groups.set(reference,existing); }
        else if (existing.customer === "—" && customer) existing.customer=customer;
        return existing;
    };
    for (const value of sales) {
        const b=record(value), ref=str(b.reference);
        if (!ref || day(b.eventDate)!==today || !Array.isArray(b.items)) continue;
        for (const value of b.items) {
            const item=record(value);
            if (item.issued !== false || typeof item.prepared !== "boolean") continue;
            const g=group(ref,str(b.clientName));
            if (item.prepared) g.prepared=true; else g.unprepared=true;
        }
    }
    for (const value of rentals) {
        const a=record(value), ref=str(a.bookingReference), state=str(a.status).toLowerCase();
        if (!ref) continue;
        if (state==="reserved" && day(a.startDate)===today) {
            // Reserved allocations can exist before approval in older data. Only confirmed operational records belong here.
            if (!["confirmed","preparing","released","return inspection","pending settlement"].includes(str(a.bookingStatus).toLowerCase())) continue;
            const g=group(ref,str(a.clientName));
            if (a.preparedAt) g.prepared=true; else if (a.preparedAt===null || a.preparedAt==="") g.unprepared=true;
        }
        if (state==="checked_out" && day(a.endDate)===today) group(ref,str(a.clientName)).returning=true;
    }
    const tasks:Task[]=[];
    for (const g of groups.values()) {
        if (g.unprepared) tasks.push({key:`${g.reference}:prepare`,reference:g.reference,customer:g.customer,activity:"Prepare",status:"Need to Prepare"});
        else if (g.prepared) tasks.push({key:`${g.reference}:release`,reference:g.reference,customer:g.customer,activity:"Release",status:"For Release"});
        if (g.returning) tasks.push({key:`${g.reference}:return`,reference:g.reference,customer:g.customer,activity:"Return",status:"Expected Return"});
    }
    const rank:Record<TaskStatus,number>={"Need to Prepare":0,"For Release":1,"Expected Return":2};
    return tasks.sort((a,b)=>rank[a.status]-rank[b.status] || a.reference.localeCompare(b.reference));
}
function buildAlerts(products:unknown[], equipment:unknown[]):Alert[] {
    const alerts:Alert[]=[];
    for (const value of products) {
        const p=record(value), id=str(p.id), name=str(p.name);
        if(!id || !name) continue;
        const variants=Array.isArray(p.variants)?p.variants:[];
        const lines=variants.length?variants:[p];
        lines.forEach((value,index)=>{
            const v=record(value), available=count(v.sellableStock ?? v.sellable_stock), threshold=count(v.alertLevel ?? v.alert_level);
            if(available===null || threshold===null || (available>0 && available>threshold)) return;
            const variant=variants.length ? str(v.variantName ?? v.variant_name) || Object.values(record(v.variantValues ?? v.variant_values)).map(str).filter(Boolean).join(" / ") || str(v.variantNumber) || `Variant ${index+1}` : "";
            alerts.push({key:`p:${id}:${str(v.id)||index}`,product:variant?`${name} (${variant})`:name,available,status:available===0?"Out of Stock":"Low Stock"});
        });
    }
    for (const value of equipment) {
        const e=record(value), id=str(e.id), name=str(e.name), available=count(e.bookableToday), threshold=count(e.alertLevel), total=count(e.totalUnits), maintenance=count(e.maintenanceUnits), missing=count(e.missingUnits);
        if (!id || !name || available===null || threshold===null || total===null || maintenance===null || missing===null) continue;
        if(available===0) alerts.push({key:`r:${id}`,product:name,available,status:total-maintenance-missing>0?"Fully Booked":"Unavailable"});
        else if(threshold>0 && available<=threshold) alerts.push({key:`r:${id}`,product:name,available,status:"Low Availability"});
    }
    return alerts.sort((a,b)=>a.available-b.available || a.product.localeCompare(b.product));
}
function Status({value}:{value:string}) {
    const color = ["Need to Prepare","Low Stock","Low Availability"].includes(value) ? "bg-[#FFF3D8] text-[#986408]" : value==="For Release" ? "bg-[#E6F7EE] text-[#17733A]" : ["Out of Stock","Unavailable"].includes(value) ? "bg-[#FDECEC] text-[#B42318]" : "bg-[#F1EBFF] text-[#6D35D4]";
    return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold leading-4 ${color}`}>{value}</span>;
}
const metricColors = {
    violet: "bg-[#F1ECFF] text-[#5F35D8]",
    green: "bg-[#E6F7EE] text-[#159455]",
    blue: "bg-[#E9F2FF] text-[#1E6FE8]",
    orange: "bg-[#FFF3DE] text-[#E68A00]",
} as const;
function Metric({label,value,helper,icon,tone,onClick,loading}:{label:string;value:number|null;helper:string;icon:ReactNode;tone:keyof typeof metricColors;onClick?:()=>void;loading:boolean}) {
    const contents=<><span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${loading?"animate-pulse bg-[#EEE8F3]":metricColors[tone]}`} aria-hidden="true">{!loading&&icon}</span><span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold leading-5 text-[#4B3E55]">{label}</span>{loading?<span className="my-2 block h-7 w-16 animate-pulse rounded-lg bg-[#EEE8F3]"/>:<span className="mt-1 block break-words text-[28px] font-bold leading-tight tracking-[-0.03em] text-[#1A1220] tabular-nums">{value===null?"—":fmtInt(value)}</span>}<span className="mt-2 block text-[11px] leading-4 text-[#8A7D92]">{helper}</span></span></>;
    const css="flex min-h-[146px] min-w-0 w-full items-center gap-4 rounded-[16px] border border-[#E6DDF0] bg-white px-5 py-4 text-left shadow-sm";
    return onClick&&!loading?<button type="button" className={`${css} transition hover:border-[#D7C9E3] hover:shadow-md focus-visible:ring-2 focus-visible:ring-[#D9C6F5]`} onClick={onClick}>{contents}</button>:<div className={css} aria-busy={loading}>{contents}</div>;
}

export default function StaffDashboard() {
    const router=useRouter();
    const {user}=useCurrentUser();
    const account=record(user);
    const [ready,setReady]=useState(false);
    const [now,setNow]=useState(()=>new Date());
    const [refreshing,setRefreshing]=useState(false);
    const [data,setData]=useState<DashboardData|null>(null);
    const request=useRef<AbortController|null>(null);
    useEffect(()=>{setReady(true);const timer=window.setInterval(()=>setNow(new Date()),30_000);return()=>window.clearInterval(timer);},[]);
    const branchId=str(account.branch_id??account.branchId) || (ready?(saved("branch_id")||saved("stocknbook_branch_id")||saved("staff_branch_id")):"");
    const storeId=str(account.store_id??account.storeId) || (ready?(saved("store_id")||saved("stocknbook_store_id")):"");
    const branchName=str(account.branch_name??account.branchName) || (ready?(saved("branch_name")||saved("stocknbook_branch_name")||saved("staff_branch_name")): "") || "Assigned Branch";
    const bookingAllowed=!isDenied(account,"bookings"), inventoryAllowed=!isDenied(account,"inventory");
    const today=manilaDay(now);
    const scope=`${storeId}:${branchId}:${str(account.id??account.staff_id)}:${bookingAllowed}:${inventoryAllowed}:${today}`;
    const load=useCallback(async(silent=false)=>{
        if(!ready || (silent && request.current)) return;
        request.current?.abort();const controller=new AbortController();request.current=controller;
        if(!silent)setRefreshing(true);
        try {
            const token=saved("token"), branch=Number(branchId);
            if(!token || !Number.isSafeInteger(branch) || branch<=0) {setData({scope,sales:null,allocations:null,equipment:null,products:null,errors:["No valid staff session or assigned branch. Please sign in again."]});return;}
            const post=async(url:string,body:RecordData)=>{
                const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(body),cache:"no-store",signal:controller.signal});
                const payload=record(await res.json());if(!res.ok || payload.success===false)throw new Error(`Request failed (${res.status})`);return payload;
            };
            const [s,r,p]=await Promise.allSettled([
                bookingAllowed&&inventoryAllowed?post("/api/bookings",{action:"get_staff_sales_booking_queue",branch_id:branch}):Promise.reject(new Error("Access not assigned")),
                inventoryAllowed?post("/api/rental-inventory",{action:"get_staff_rental_workspace"}):Promise.reject(new Error("Access not assigned")),
                inventoryAllowed?post("/api/products",{action:"get_products",branch_id:branch}):Promise.reject(new Error("Access not assigned")),
            ]);
            if(controller.signal.aborted)return;
            const sales= s.status==="fulfilled" && s.value.success===true && Array.isArray(s.value.bookings)?s.value.bookings:null;
            const allocations=bookingAllowed && r.status==="fulfilled" && r.value.success===true && Array.isArray(r.value.allocations)?r.value.allocations:null;
            const equipment=r.status==="fulfilled" && r.value.success===true && Array.isArray(r.value.equipment)?r.value.equipment:null;
            const products=p.status==="fulfilled" && Array.isArray(p.value.products)?p.value.products.filter(v=>str(record(v).branchId??record(v).branch_id)===branchId):null;
            const errors=[!sales&&"Sales booking tasks unavailable.",!allocations&&"Rental booking tasks unavailable.",!equipment&&"Rental stock unavailable.",!products&&"Consumable stock unavailable."].filter((v):v is string=>Boolean(v));
            setData({scope,sales,allocations,equipment,products,errors});
        } finally {if(request.current===controller){request.current=null;setRefreshing(false);}}
    },[ready,branchId,scope,bookingAllowed,inventoryAllowed]);
    useEffect(()=>{
        if(!ready)return;
        void load();const refresh=()=>{if(document.visibilityState==="visible")void load(true);};
        const timer=window.setInterval(refresh,60_000);
        window.addEventListener("focus",refresh);window.addEventListener("stocknbook:booking-updated",refresh);
        return()=>{window.clearInterval(timer);window.removeEventListener("focus",refresh);window.removeEventListener("stocknbook:booking-updated",refresh);request.current?.abort();request.current=null;};
    },[load,ready]);
    const current=data?.scope===scope?data:null;
    const tasks=useMemo(()=>buildTasks(current?.sales||[],current?.allocations||[],today),[current,today]);
    const alerts=useMemo(()=>buildAlerts(current?.products||[],current?.equipment||[]),[current]);
    const completeTasks=!!current?.sales&&!!current?.allocations, completeStock=!!current?.products&&!!current?.equipment;
    const statusCount=(status:TaskStatus)=>status==="Expected Return"?current?.allocations?tasks.filter(t=>t.status===status).length:null:completeTasks?tasks.filter(t=>t.status===status).length:null;
    const openBookings=bookingAllowed&&inventoryAllowed?()=>router.push("/bookings"):undefined;
    const openInventory=inventoryAllowed?()=>router.push("/inventory"):undefined;
    return <>
        <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur"><div className="flex min-h-[88px] flex-wrap items-center justify-between gap-4 px-6 py-3"><div className="min-w-0"><h1 className="text-[25px] font-bold tracking-[-0.02em] text-[#1A1220]">Staff Dashboard</h1><p className="mt-1 text-[12px] text-[#7A6A84]">Daily operations overview for {branchName}.</p></div><div className="flex flex-wrap gap-2.5"><span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">{ready?clock(now):"Loading date..."}</span><button type="button" onClick={()=>void load()} disabled={!ready||refreshing} className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:opacity-60"><RefreshCw size={16} className={refreshing?"animate-spin":""}/>{refreshing?"Refreshing...":"Refresh"}</button></div></div></header>
        <main className="space-y-4 px-5 py-5 font-sans" aria-busy={!current||refreshing}>
            {current&&current.errors.length>0&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{current.errors.join(" ")}</p>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric tone="violet" label="To Prepare" value={statusCount("Need to Prepare")} helper="Bookings needing preparation today" icon={<ClipboardCheck size={24}/>} onClick={openBookings} loading={!current}/>
                <Metric tone="green" label="For Release" value={statusCount("For Release")} helper="Prepared bookings due for release today" icon={<Box size={24}/>} onClick={openBookings} loading={!current}/>
                <Metric tone="blue" label="Expected Returns" value={statusCount("Expected Return")} helper="Rental returns expected today" icon={<CornerUpLeft size={24}/>} onClick={openBookings} loading={!current}/>
                <Metric tone="orange" label="Stock Alert" value={completeStock?alerts.length:null} helper="Products needing attention" icon={<AlertTriangle size={24}/>} onClick={openInventory} loading={!current}/>
            </div>
            <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                <section className={`${cardClass} flex min-h-[340px] flex-col`}>
                    <div className={headerClass}><div className="flex min-w-0 items-center gap-2.5"><span className={iconClass}><CalendarClock size={19}/></span><div className="min-w-0"><h2 className="text-[15px] font-bold text-[#1A1220]">Today&apos;s Booking Schedule</h2><p className="mt-0.5 text-[11px] text-[#8A7D92]">Preparation, release, and return tasks for today</p></div></div>{openBookings&&<button type="button" onClick={openBookings} className={linkClass}>View All <ChevronRight size={14}/></button>}</div>
                    <div className="max-h-[360px] flex-1 overflow-auto"><table className="w-full min-w-[430px] border-collapse text-left text-[11px]">
                        <thead className={`sticky top-0 ${tableHeader}`}><tr>{["Booking No.","Customer","Activity","Status"].map(h=><th key={h} scope="col" className="px-3 py-3">{h}</th>)}</tr></thead>
                        <tbody>{tasks.slice(0,5).map(t=><tr key={t.key} className="border-t border-[#EEE7F2] hover:bg-[#FFFCF7]"><td className="break-words px-3 py-3 font-semibold text-[#2B174C]">{t.reference}</td><td className="px-3 py-3 text-[#2B174C]">{t.customer}</td><td className="px-3 py-3 text-[#5F4E75]">{t.activity}</td><td className="px-3 py-3"><Status value={t.status}/></td></tr>)}{!tasks.length&&<tr><td colSpan={4} className="px-4 py-12 text-center text-[#8A7D92]">{!current?"Loading schedule...":completeTasks?"No booking tasks scheduled for today.":"Booking schedule unavailable."}</td></tr>}</tbody>
                    </table></div>{current&&!completeTasks&&tasks.length>0&&<p className="px-4 py-2 text-[11px] text-[#806A8C]">Only available booking tasks are shown.</p>}
                </section>
                <section className={`${cardClass} flex min-h-[340px] flex-col`}>
                    <div className={headerClass}><div className="flex min-w-0 items-center gap-2.5"><span className={iconClass}><Box size={19}/></span><div className="min-w-0"><h2 className="text-[15px] font-bold text-[#1A1220]">Stock Alerts</h2><p className="mt-0.5 text-[11px] text-[#8A7D92]">Low stock and unavailable items</p></div></div>{openInventory&&<button type="button" onClick={openInventory} className={linkClass}>View All <ChevronRight size={14}/></button>}</div>
                    <div className="max-h-[360px] flex-1 overflow-auto"><table className="w-full min-w-[320px] border-collapse text-left text-[11px]">
                        <thead className={`sticky top-0 ${tableHeader}`}><tr>{["Product","Available","Status"].map(h=><th key={h} scope="col" className="px-3 py-3">{h}</th>)}</tr></thead>
                        <tbody>{alerts.slice(0,5).map(a=><tr key={a.key} className="border-t border-[#EEE7F2] hover:bg-[#FFFCF7]"><td className="px-3 py-3 font-semibold text-[#2B174C]">{a.product}</td><td className="px-3 py-3 text-[#5F4E75] tabular-nums">{fmtInt(a.available)}</td><td className="px-3 py-3"><Status value={a.status}/></td></tr>)}{!alerts.length&&<tr><td colSpan={3} className="px-4 py-12 text-center text-[#8A7D92]">{!current?"Loading stock alerts...":completeStock?"No stock alerts.":"Stock alerts unavailable."}</td></tr>}</tbody>
                    </table></div>{current&&!completeStock&&alerts.length>0&&<p className="px-4 py-2 text-[11px] text-[#806A8C]">Only available stock records are shown.</p>}
                </section>
            </div>
        </main>
    </>;
}
