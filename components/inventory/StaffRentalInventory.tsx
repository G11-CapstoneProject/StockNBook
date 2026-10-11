"use client";

import * as React from "react";
import Link from "next/link";
import {
    AlertTriangle, CalendarClock, ClipboardCheck, ClipboardList, Clock3, Eye,
    PackageCheck, PackageSearch, RotateCcw, Search, Sparkles, Truck, X, RefreshCw,
} from "lucide-react";
import { useStaffRentalInventory, type StaffRentalAllocation, type StaffRentalAction } from "@/hooks/useRentalInventory";

const panel = "overflow-hidden rounded-2xl border border-[#E6DDF0] bg-white shadow-sm";
const action = "inline-flex h-[40px] items-center justify-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-4 text-xs font-semibold text-[#2B174C] hover:bg-[#F7F1FF] disabled:opacity-50";
const primary = "inline-flex h-[40px] items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 text-xs font-semibold text-white hover:bg-[#1B0D31] disabled:opacity-50";
const th = "px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-[#806A8C]";

type TaskType = "prepare" | "release" | "return" | "inspect" | "clean" | "damage";
const taskLabel: Record<TaskType, string> = {
    prepare: "Prepare", release: "Release", return: "Receive Return",
    inspect: "Inspect", clean: "Mark Cleaned", damage: "Damage Reported",
};
const taskToAction: Partial<Record<TaskType, StaffRentalAction>> = {
    prepare: "prepare_rental_allocation", release: "release_rental_allocation",
    return: "return_rental_allocation", inspect: "inspect_rental_allocation", clean: "clean_rental_allocation",
};
function taskType(a: StaffRentalAllocation): TaskType | null {
    if (a.status === "reserved") return a.preparedAt ? "release" : "prepare";
    if (a.status === "checked_out") return "return";
    if (a.status === "returned") {
        if (a.inspectionStatus === "pending") return "inspect";
        if (a.inspectionStatus === "cleaning") return "clean";
        if (a.inspectionStatus === "damaged") return "damage";
    }
    return null;
}
function manilaDate() {
    const bits = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Manila",day:"2-digit",month:"2-digit",year:"numeric"}).formatToParts(new Date());
    const get = (type: string) => bits.find(x=>x.type===type)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
}
function dateTime(s?: string | null) {
    if (!s) return "—";
    const parsed = new Date(s.includes("T") ? s : s.replace(" ", "T")+"+08:00");
    return Number.isNaN(parsed.getTime()) ? s : parsed.toLocaleString("en-PH", {timeZone:"Asia/Manila",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
}
function Header({ icon, title, subtitle, right }: {icon:React.ReactNode;title:string;subtitle:string;right?:React.ReactNode}) {
    return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3.5">
        <div className="flex items-center gap-3"><span className="rounded-xl bg-[#F1EBFF] p-2 text-[#5A35A5]">{icon}</span>
            <div><h3 className="text-[15px] font-bold text-[#21132E]">{title}</h3><p className="text-[11px] text-[#86778F]">{subtitle}</p></div></div>{right}
    </div>;
}
function Empty({children}:{children:React.ReactNode}) {
    return <div className="flex min-h-28 flex-col items-center justify-center gap-2 p-5 text-center text-xs text-[#806A8C]"><PackageSearch size={22}/>{children}</div>;
}
export default function StaffRentalInventory({branchName}:{branchName:string}) {
    const rental=useStaffRentalInventory();
    const [search,setSearch]=React.useState("");
    const [taskFilter,setTaskFilter]=React.useState<TaskType | "all">("all");
    const [category,setCategory]=React.useState("all");
    const [selected,setSelected]=React.useState<StaffRentalAllocation|null>(null);
    const [viewEquipment,setViewEquipment]=React.useState<number|null>(null);
    const [condition,setCondition]=React.useState<"good" | "cleaning" | "damaged">("good");
    const [notes,setNotes]=React.useState("");
    const [submitError,setSubmitError]=React.useState("");
    const [notice,setNotice]=React.useState("");
    const today=manilaDate();
    const equipmentById=React.useMemo(()=>new Map(rental.equipment.map(e=>[e.id,e])),[rental.equipment]);
    const allTasks=React.useMemo(()=>rental.allocations.map(a=>({item:a,type:taskType(a)})).filter(x=>x.type!==null),[rental.allocations]);
    const forReturn=allTasks.filter(x=>x.type==="return"&&x.item.endDate<=today).length;
    const ready=allTasks.filter(x=>x.type==="release"&&x.item.startDate<=today).length;
    const inspection=allTasks.filter(x=>x.type==="inspect").length;
    const cleaning=allTasks.filter(x=>x.type==="clean").length;
    const visibleTasks=allTasks.filter(x=>{
        const text=[x.item.equipmentName,x.item.bookingReference,x.item.equipmentNumber].join(" ").toLowerCase();
        return text.includes(search.trim().toLowerCase()) && (taskFilter==="all"||taskFilter===x.type);
    });
    const categories=[...new Set(rental.equipment.map(e=>e.category))].sort();
    const visibleEquipment=rental.equipment.filter(e=>[e.name,e.category,e.equipmentNumber].join(" ").toLowerCase().includes(search.trim().toLowerCase())&&(category==="all"||e.category===category));
    const selectedEquipment=rental.equipment.find(e=>e.id===viewEquipment);
    const perform=async()=>{
        if(!selected)return;
        const kind=taskType(selected);
        const apiAction=kind&&taskToAction[kind];
        if(!apiAction)return;
        setSubmitError("");setNotice("");
        try {
            await rental.act(apiAction,selected.allocationId,kind==="inspect"?{condition,notes:notes.trim()}:{notes:notes.trim()});
            setNotice(`${taskLabel[kind]} recorded for ${selected.bookingReference}.`);
            setSelected(null);setNotes("");setCondition("good");
        } catch(error) {setSubmitError(error instanceof Error?error.message:"Unable to save rental action.");}
    };
    return <div className="space-y-4" aria-label="Staff Rental Inventory">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
            {title:"Ready for Release",num:ready,caption:"Prepared, due for handover",icon:<Truck size={19}/>},
            {title:"For Return Today / Overdue",num:forReturn,caption:"Checked-out units due today or earlier",icon:<CalendarClock size={19}/>},
            {title:"Pending Inspection",num:inspection,caption:"Returned equipment held for inspection",icon:<ClipboardCheck size={19}/>},
            {title:"Needs Cleaning",num:cleaning,caption:"Equipment held until cleaning is recorded",icon:<Sparkles size={19}/>},
        ].map(c=><div key={c.title} className="rounded-2xl border border-[#E6DDF0] bg-white p-3 shadow-sm"><div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold text-[#21132E]">{c.title}</p><span className="rounded-full bg-[#F1EBFF] p-2 text-[#5A35A5]">{c.icon}</span></div><p className="mt-3 text-2xl font-bold text-[#2B174C]">{rental.connected?c.num:"—"}</p><p className="text-[11px] text-[#8A7D90]">{c.caption}</p></div>)}</div>
        {rental.error&&<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Rental operations unavailable: {rental.error} <button type="button" className="underline" onClick={()=>void rental.refresh(true)}>Retry</button></p>}
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
            <section className={panel}><Header icon={<ClipboardList size={18}/>} title="Rental Operations Queue" subtitle="Confirmed bookings: prepare, release, receive, inspect, and clean"
                                               right={<select aria-label="Filter rental tasks" className={action} value={taskFilter} onChange={e=>setTaskFilter(e.target.value as TaskType|"all")}>
                                                   <option value="all">All Tasks</option><option value="prepare">Prepare</option><option value="release">Release</option><option value="return">Returns</option><option value="inspect">Inspect</option><option value="clean">Cleaning</option><option value="damage">Damage Reported</option>
                                               </select>}/>
                <div className="max-h-[350px] overflow-auto"><table className="w-full min-w-[560px] text-xs"><thead className="sticky top-0 bg-[#FFFDF8]"><tr>{["Booking Ref.","Equipment","Qty","Due","Task","Action"].map(h=><th className={th} key={h}>{h}</th>)}</tr></thead><tbody>
                {visibleTasks.slice(0,50).map(({item,type})=><tr key={item.allocationId} className="border-t border-[#F0EAF4] text-[#2B174C]"><td className="px-3 py-3">{item.bookingReference}</td><td className="px-3 py-3 font-medium">{item.equipmentName}</td><td className="px-3 py-3">{item.quantity}</td><td className="px-3 py-3">{type==="return"?item.endDate:item.startDate}</td><td className="px-3 py-3">{type&&taskLabel[type]}</td><td className="px-3 py-3"><button type="button" className={action} onClick={()=>{setSelected(item);setSubmitError("");setCondition("good");setNotes("");}}>Review</button></td></tr>)}
                </tbody></table>{rental.connected&&visibleTasks.length===0&&<Empty>No matching rental tasks. Only confirmed booking allocations create tasks.</Empty>}</div>
            </section>
            <section className={panel}><Header icon={<Clock3 size={18}/>} title="Recent Rental Activity" subtitle="Latest branch equipment movements (read-only)"/>
                <div className="max-h-[350px] overflow-auto"><table className="w-full min-w-[420px] text-xs"><thead className="sticky top-0 bg-[#FFFDF8]"><tr>{["Time","Equipment","Activity","Qty","Booking Ref."].map(h=><th className={th} key={h}>{h}</th>)}</tr></thead><tbody>
                {rental.activity.slice(0,8).map(e=><tr key={e.id} className="border-t border-[#F0EAF4] text-[#2B174C]"><td className="px-3 py-3">{dateTime(e.occurredAt)}</td><td className="px-3 py-3">{e.equipmentName}</td><td className="px-3 py-3">{e.type.replaceAll("_"," ")}</td><td className="px-3 py-3">{e.quantity}</td><td className="px-3 py-3">{e.referenceNumber||"—"}</td></tr>)}
                </tbody></table>{rental.connected&&rental.activity.length===0&&<Empty>No recorded equipment movements yet.</Empty>}</div>
            </section>
        </div>
        <div className="flex flex-wrap items-center gap-2"><label className="relative min-w-[180px] flex-1"><span className="sr-only">Search rental equipment or booking</span><Search size={17} className="absolute left-3 top-3 text-[#806A8C]"/><input className="h-10 w-full rounded-xl border border-[#E6DDF0] bg-white pl-9 pr-3 text-sm" placeholder="Search equipment or booking..." value={search} onChange={e=>setSearch(e.target.value)}/></label>
            <button type="button" className={action} disabled={rental.refreshing} onClick={()=>void rental.refresh(true)}><RefreshCw size={16} className={rental.refreshing?"animate-spin":""}/> Refresh</button>
            <button type="button" className={action} onClick={()=>setTaskFilter("return")}><RotateCcw size={16}/> Returns</button>
            <Link href="/bookings" className={primary}><CalendarClock size={16}/> Bookings</Link></div>
        <section className={panel}><Header icon={<PackageCheck size={18}/>} title="Branch Rental Equipment" subtitle={`Daily rental availability and condition · ${branchName}`}
                                           right={<select className={action} aria-label="Filter equipment category" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All Categories</option>{categories.map(c=><option key={c}>{c}</option>)}</select>}/>
            <div className="max-h-[420px] overflow-auto"><table className="w-full min-w-[700px] text-xs"><thead className="sticky top-0 bg-[#FFFDF8]"><tr>{["Equipment No.","Equipment","Category","Total","Physically Available","Out","On Hold","Action"].map(h=><th className={th} key={h}>{h}</th>)}</tr></thead><tbody>{visibleEquipment.map(e=><tr key={e.id} className="border-t border-[#F0EAF4] text-[#2B174C]"><td className="px-3 py-3">{e.equipmentNumber||"—"}</td><td className="px-3 py-3 font-medium">{e.name}</td><td className="px-3 py-3">{e.category}</td><td className="px-3 py-3">{e.totalUnits}</td><td className="px-3 py-3">{Math.max(0,e.totalUnits-e.rentedOutUnits-e.maintenanceUnits-e.missingUnits)}</td><td className="px-3 py-3">{e.rentedOutUnits}</td><td className="px-3 py-3">{e.maintenanceUnits}</td><td className="px-3 py-3"><button className={action} onClick={()=>setViewEquipment(e.id)}><Eye size={15}/> View</button></td></tr>)}</tbody></table>{rental.connected&&visibleEquipment.length===0&&<Empty>No rental equipment found in this branch.</Empty>}</div>
            <p className="px-4 py-2 text-[11px] text-[#806A8C]">Physically Available excludes units out, under inspection/maintenance, or missing. Booking-date availability must still be checked before confirming a new reservation.</p>
        </section>
        {notice&&<div role="status" className="fixed bottom-5 right-5 z-[110] max-w-sm rounded-xl border border-green-200 bg-white p-4 text-sm text-green-800 shadow-lg">{notice}<button onClick={()=>setNotice("")} className="ml-3 underline">Dismiss</button></div>}
        {(selected||selectedEquipment)&&<div role="presentation" className="fixed inset-0 z-[90] flex items-center justify-center bg-[#21132E]/50 p-4" onMouseDown={e=>{if(e.target===e.currentTarget&&!rental.saving){setSelected(null);setViewEquipment(null);}}}>
            <section role="dialog" aria-modal="true" aria-label="Rental operation review" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
                <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-bold text-[#21132E]">{selected?taskLabel[taskType(selected)||"prepare"]:selectedEquipment?.name}</h3><button aria-label="Close dialog" disabled={rental.saving} onClick={()=>{setSelected(null);setViewEquipment(null);}}><X size={19}/></button></div>
                {selected?<div className="mt-4 space-y-3 text-sm"><p className="font-semibold">{selected.equipmentName} · {selected.quantity} units</p><p>Confirmed booking: <strong>{selected.bookingReference}</strong></p><p>Rental period: {selected.startDate} – {selected.endDate}</p>
                    {taskType(selected)==="return"&&<p className="rounded-xl bg-amber-50 p-3 text-xs">Returned units are automatically held for inspection; they are not immediately available for another rental.</p>}
                    {taskType(selected)==="inspect"&&<label className="block text-xs font-semibold">Equipment condition<select className="mt-1 h-10 w-full rounded-xl border p-2 text-sm" value={condition} onChange={e=>setCondition(e.target.value as typeof condition)}><option value="good">Good · ready to use</option><option value="cleaning">Needs cleaning</option><option value="damaged">Damaged · Manager follow-up</option></select></label>}
                    {taskType(selected)==="damage"&&<div className="rounded-lg bg-amber-50 p-3 text-xs"><AlertTriangle size={16} className="inline"/> Damage was reported. These units remain on hold until the Manager completes maintenance.</div>}
                    {taskType(selected)!=="damage"&&<label className="block text-xs font-semibold">Notes{condition==="damaged"&&taskType(selected)==="inspect"?" (required)":" (optional)"}<textarea className="mt-1 w-full rounded-xl border p-3 text-sm" maxLength={400} rows={3} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Condition, missing accessories, handover notes..."/></label>}
                    {submitError&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{submitError}</p>}
                    <div className="flex justify-end gap-2"><button className={action} disabled={rental.saving} onClick={()=>setSelected(null)}>Cancel</button>{taskType(selected)!=="damage"&&<button className={primary} disabled={rental.saving||(taskType(selected)==="inspect"&&condition==="damaged"&&notes.trim().length<5)} onClick={()=>void perform()}>{rental.saving?"Saving...":"Confirm "+taskLabel[taskType(selected)||"prepare"]}</button>}</div>
                </div>:selectedEquipment&&<div className="mt-4 space-y-2 text-sm"><p>Equipment No.: {selectedEquipment.equipmentNumber}</p><p>Total units: {selectedEquipment.totalUnits}</p><p>Out: {selectedEquipment.rentedOutUnits}</p><p>Inspection, cleaning and maintenance holds: {selectedEquipment.maintenanceUnits}</p><p>Missing: {selectedEquipment.missingUnits}</p><p className="rounded-lg bg-[#F7F3FC] p-3 text-xs">Product catalog and rental pricing are managed by the Manager.</p></div>}
            </section>
        </div>}
    </div>;
}
