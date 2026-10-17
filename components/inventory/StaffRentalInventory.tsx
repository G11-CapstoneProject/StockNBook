"use client";

import * as React from "react";
import Link from "next/link";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
    AlertTriangle, CalendarClock, ClipboardCheck, ClipboardList, Clock3, Eye, CalendarDays,
    PackageCheck, PackageSearch, RotateCcw, Search, Sparkles, Truck, X, RefreshCw,
} from "lucide-react";
import { useStaffRentalInventory, type StaffRentalAllocation, type StaffRentalAction, type StaffRentalEquipmentSchedule } from "@/hooks/useRentalInventory";

const panel = "overflow-hidden rounded-2xl border border-[#E6DDF0] bg-white shadow-sm";
const action = "inline-flex h-[40px] items-center justify-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-4 text-xs font-semibold text-[#2B174C] hover:bg-[#F7F1FF] disabled:opacity-50";
const primary = "inline-flex h-[40px] items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 text-xs font-semibold text-white hover:bg-[#1B0D31] disabled:opacity-50";
const th = "px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-[#806A8C]";

type TaskType = "prepare" | "release" | "return" | "inspect" | "clean" | "damage";
type TimeBucket = "all" | "today" | "upcoming" | "overdue";
const timeBucketLabel: Record<Exclude<TimeBucket,"all">,string> = {
    today:"Today", upcoming:"Upcoming", overdue:"Overdue",
};
function taskDueDate(a:StaffRentalAllocation,type:TaskType) {
    return type==="return"?a.endDate:a.startDate;
}
function taskBucket(a:StaffRentalAllocation,type:TaskType,today:string):Exclude<TimeBucket,"all"> {
    // Inspections are actionable as soon as units arrive, regardless of the original booking date.
    if(type==="inspect")return "today";
    const due=taskDueDate(a,type);
    return due<today?"overdue":due===today?"today":"upcoming";
}
const taskLabel: Record<TaskType, string> = {
    prepare: "Mark Prepared", release: "Release", return: "Receive Return",
    inspect: "Inspect Return", clean: "Mark Cleaned", damage: "Damage Reported",
};
// These are transaction stages, not editable equipment statuses. Only the next valid
// operation is shown; the backend validates every transition and stock quantity.
const workflowStages = ["Prepare", "Release", "Receive Return", "Inspect", "Equipment care if needed"] as const;
const stageForTask: Record<Exclude<TaskType, "damage">, number> = {
    prepare: 0, release: 1, return: 2, inspect: 3, clean: 4,
};
const taskHelp: Record<TaskType, string> = {
    prepare: "Confirm equipment has been checked and gathered for this booking. This does not mark it as rented out.",
    release: "Confirm physical handover to the customer. Only then will Out on Rental increase.",
    return: "Count what the customer physically returned. Returned units stay on hold until inspection.",
    inspect: "Record how many units are good, need cleaning, or are damaged. Good units return to Available.",
    clean: "Finish the cleaning task in Equipment Care & Maintenance. Cleaned units return to Available; damaged units stay on hold.",
    damage: "Damaged equipment remains on hold. The Manager must authorize significant repairs and safe release.",
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
    const {user}=useCurrentUser();
    const inventoryPermission=user?.permissions?.inventory_access ?? user?.permissions?.inventory;
    // UI-only courtesy: the Rental Lambda separately enforces current DB grants.
    const canOperate=inventoryPermission===true || inventoryPermission==="true" || inventoryPermission==="full";
    const [search,setSearch]=React.useState("");
    const [taskFilter,setTaskFilter]=React.useState<"all" | "prepare" | "release" | "return" | "inspect">("all");
    const [timeFilter,setTimeFilter]=React.useState<TimeBucket>("all");
    const [careFilter,setCareFilter]=React.useState<"all" | "cleaning" | "routine" | "repairs">("all");
    const [category,setCategory]=React.useState("all");
    const [selected,setSelected]=React.useState<StaffRentalAllocation|null>(null);
    const [viewEquipment,setViewEquipment]=React.useState<number|null>(null);
    const [scheduleEquipmentId,setScheduleEquipmentId]=React.useState<number|null>(null);
    const [scheduleDate,setScheduleDate]=React.useState(manilaDate);
    const [schedule,setSchedule]=React.useState<StaffRentalEquipmentSchedule|null>(null);
    const [scheduleError,setScheduleError]=React.useState("");
    const [scheduleLoading,setScheduleLoading]=React.useState(false);
    const [returnMissing,setReturnMissing]=React.useState("0");
    const [goodUnits,setGoodUnits]=React.useState("0");
    const [cleaningUnits,setCleaningUnits]=React.useState("0");
    const [damagedUnits,setDamagedUnits]=React.useState("0");
    const [notes,setNotes]=React.useState("");
    const [submitError,setSubmitError]=React.useState("");
    const [notice,setNotice]=React.useState("");
    const [stockTask,setStockTask]=React.useState<
        {kind:"receive";id:number;label:string;max:number} |
        {kind:"issue";id:number;label:string;max:number;bookingReference?:string} |
        {kind:"complete";id:number;label:string;max:number} |
        {kind:"routine";id:number;label:string;max:number} | null>(null);
    const [stockQuantity,setStockQuantity]=React.useState("");
    const [stockNotes,setStockNotes]=React.useState("");
    const [issueType,setIssueType]=React.useState<"routine"|"damage"|"missing">("damage");
    const today=manilaDate();
    const equipmentById=React.useMemo(()=>new Map(rental.equipment.map(e=>[e.id,e])),[rental.equipment]);
    const allTasks=React.useMemo(()=>rental.allocations.map(a=>({item:a,type:taskType(a)})).filter(x=>x.type!==null),[rental.allocations]);
    const returnTasks=allTasks.filter(x=>x.type==="return"&&x.item.endDate<=today);
    const forReturn=returnTasks.length;
    const readyTasks=allTasks.filter(x=>x.type==="release"&&x.item.startDate<=today);
    const ready=readyTasks.length;
    const inspectionTasks=allTasks.filter(x=>x.type==="inspect");
    const inspection=inspectionTasks.length;
    const inspectionUnits=inspectionTasks.reduce((sum,x)=>sum+(x.item.returnedReceivedUnits??x.item.quantity),0);
    // The booking queue stops after inspection. Cleaning is an equipment-care
    // task, using the SAME allocation and clean_rental_allocation API action.
    // Do not create a second maintenance record for the same returned units.
    const careTasks=React.useMemo(()=>[
        ...rental.allocations.filter(a=>taskType(a)==="clean").map(a=>({
            key:`booking-${a.allocationId}`,
            kind:"cleaning" as const,
            equipmentName:a.equipmentName,
            units:a.cleaningUnits>0?a.cleaningUnits:a.quantity,
            reference:a.bookingReference,
            allocation:a,
        })),
        ...rental.maintenanceTasks.map(t=>({
            key:`maintenance-${t.id}`,
            kind:t.conditionStatus==="Routine"?"routine" as const:"repairs" as const,
            equipmentName:t.equipmentName,
            units:t.units,
            reference:`MNT-${String(t.id).padStart(6,"0")}`,
            maintenance:t,
        })),
    ],[rental.allocations,rental.maintenanceTasks]);
    // Explain holds without counting damage twice: damaged inspection units are
    // represented by rental_maintenance_records. A residual means another hold
    // exists or the capped workspace did not return every underlying record.
    const holdBreakdown=React.useMemo(()=>{
        const breakdown=new Map<number,{inspection:number;cleaning:number;routine:number;repairs:number}>();
        const get=(id:number)=>{
            if(!breakdown.has(id))breakdown.set(id,{inspection:0,cleaning:0,routine:0,repairs:0});
            return breakdown.get(id)!;
        };
        for(const a of rental.allocations){
            if(a.status!=="returned")continue;
            if(a.inspectionStatus==="pending")get(a.equipmentId).inspection+=a.returnedReceivedUnits??a.quantity;
            else if(a.inspectionStatus==="cleaning")get(a.equipmentId).cleaning+=a.cleaningUnits;
        }
        for(const task of rental.maintenanceTasks){
            if(task.conditionStatus==="Routine")get(task.equipmentId).routine+=task.units;
            else get(task.equipmentId).repairs+=task.units;
        }
        return breakdown;
    },[rental.allocations,rental.maintenanceTasks]);
    const openSchedule=(equipmentId:number)=>{
        setScheduleDate(today);setSchedule(null);setScheduleError("");setScheduleEquipmentId(equipmentId);
    };
    React.useEffect(()=>{
        if(scheduleEquipmentId===null)return;
        const abort=new AbortController();
        setScheduleLoading(true);setSchedule(null);setScheduleError("");
        void rental.getEquipmentSchedule(scheduleEquipmentId,scheduleDate,abort.signal).then(data=>{
            if(!abort.signal.aborted)setSchedule(data);
        }).catch(error=>{
            if(!abort.signal.aborted)setScheduleError(error instanceof Error?error.message:"Unable to load equipment schedule.");
        }).finally(()=>{if(!abort.signal.aborted)setScheduleLoading(false);});
        return ()=>abort.abort();
    },[scheduleEquipmentId,scheduleDate,rental.getEquipmentSchedule]);
    const cleaning=careTasks.filter(t=>t.kind==="cleaning").reduce((sum,t)=>sum+t.units,0);
    const visibleCareTasks=careTasks.filter(t=>careFilter==="all"||careFilter===t.kind);
    const bookingTasks=allTasks.filter(x=>x.type!=="clean"&&x.type!=="damage");
    const visibleTasks=bookingTasks.filter(x=>{
        const text=[x.item.equipmentName,x.item.bookingReference,x.item.equipmentNumber].join(" ").toLowerCase();
        return text.includes(search.trim().toLowerCase()) && (taskFilter==="all"||taskFilter===x.type)
            && (timeFilter==="all"||taskBucket(x.item,x.type!,today)===timeFilter);
    }).sort((a,b)=>{
        const priority={overdue:0,today:1,upcoming:2};
        const pa=priority[taskBucket(a.item,a.type!,today)],pb=priority[taskBucket(b.item,b.type!,today)];
        return pa-pb||taskDueDate(a.item,a.type!).localeCompare(taskDueDate(b.item,b.type!))||a.item.allocationId-b.item.allocationId;
    });
    const categories=[...new Set(rental.equipment.map(e=>e.category))].sort();
    const visibleEquipment=rental.equipment.filter(e=>[e.name,e.category,e.equipmentNumber].join(" ").toLowerCase().includes(search.trim().toLowerCase())&&(category==="all"||e.category===category));
    const selectedEquipment=rental.equipment.find(e=>e.id===viewEquipment);
    const openRentalAction=(item:StaffRentalAllocation)=>{
        setSelected(item);setSubmitError("");setReturnMissing("0");
        setGoodUnits(String(item.returnedReceivedUnits??item.quantity));
        setCleaningUnits("0");setDamagedUnits("0");setNotes("");
    };
    const reportIssueBeforeRelease=(allocation:StaffRentalAllocation)=>{
        if(!canOperate)return;
        const equipment=equipmentById.get(allocation.equipmentId);
        if(!equipment){setSubmitError("Equipment could not be loaded. Refresh and try again.");return;}
        const physicallyAvailable=Math.max(0,equipment.totalUnits-equipment.rentedOutUnits-
            equipment.maintenanceUnits-equipment.missingUnits);
        if(physicallyAvailable<1){
            setSubmitError("No physically available units can be flagged. Ask the Manager to resolve the shortage.");
            return;
        }
        setSelected(null);
        startStockTask({kind:"issue",id:equipment.id,label:equipment.name,max:physicallyAvailable,
            bookingReference:allocation.bookingReference});
    };
    const perform=async()=>{
        if(!canOperate) {setSubmitError("Full Inventory access is required for rental operations.");return;}
        if(!selected)return;
        const kind=taskType(selected);
        const apiAction=kind&&taskToAction[kind];
        if(!apiAction)return;
        setSubmitError("");setNotice("");
        try {
            if(kind==="return"){
                const missing=Number(returnMissing);
                if(returnMissing.trim()===""||!Number.isSafeInteger(missing)||missing<0||missing>selected.quantity)
                    throw new Error(`Missing units must be between 0 and ${selected.quantity}.`);
                if(missing>0&&notes.trim().length<5)throw new Error("Explain missing units (at least 5 characters).");
                await rental.act(apiAction,selected.allocationId,{missingUnits:missing,notes:notes.trim()});
            }else if(kind==="inspect"){
                const values=[goodUnits,cleaningUnits,damagedUnits];
                const numbers=values.map(Number);
                const returned=selected.returnedReceivedUnits ?? selected.quantity;
                if(values.some(v=>v.trim()==="")||numbers.some(n=>!Number.isSafeInteger(n)||n<0)||
                    numbers.reduce((a,n)=>a+n,0)!==returned)
                    throw new Error(`Good, cleaning, and damaged quantities must total ${returned} returned units.`);
                if(numbers[2]>0&&notes.trim().length<5)throw new Error("Describe the damage (at least 5 characters).");
                await rental.act(apiAction,selected.allocationId,{goodUnits:numbers[0],cleaningUnits:numbers[1],
                    damagedUnits:numbers[2],notes:notes.trim()});
            }else await rental.act(apiAction,selected.allocationId,{notes:notes.trim()});
            setNotice(`${taskLabel[kind]} recorded for ${selected.bookingReference}.`);
            setSelected(null);setNotes("");
        } catch(error) {setSubmitError(error instanceof Error?error.message:"Unable to save rental action.");}
    };
    const startStockTask=(task:NonNullable<typeof stockTask>)=>{
        if(!canOperate)return;
        setStockTask(task);setStockQuantity(task.kind==="receive"?String(task.max):"1");setStockNotes("");setIssueType("damage");setSubmitError("");
    };
    const performStock=async()=>{
        if(!canOperate){setSubmitError("Full Inventory access is required for physical receiving and condition tasks.");return;}
        if(!stockTask)return;
        const quantity=Number(stockQuantity);
        if(!Number.isSafeInteger(quantity)||quantity<1||quantity>stockTask.max){
            setSubmitError(`Enter 1–${stockTask.max} units.`);return;
        }
        if(stockTask.kind!=="receive"&&stockNotes.trim().length<5){
            setSubmitError("Describe the condition or repair in at least 5 characters.");return;
        }
        setSubmitError("");setNotice("");
        try {
            if(stockTask.kind==="receive")await rental.actStock({action:"staff_receive_rental_purchase",taskId:stockTask.id,quantity});
            else if(stockTask.kind==="issue")await rental.actStock({action:"staff_report_equipment_issue",equipmentId:stockTask.id,quantity,
                reason:stockTask.bookingReference?`Booking ${stockTask.bookingReference}: ${stockNotes.trim()}`:stockNotes.trim(),issueType});
            else if(stockTask.kind==="routine")await rental.actStock({action:"staff_complete_routine_maintenance",maintenanceId:stockTask.id,quantity,notes:stockNotes.trim()});
            else await rental.actStock({action:"staff_submit_repair_completion",maintenanceId:stockTask.id,quantity,notes:stockNotes.trim()});
            setNotice(stockTask.kind==="receive"?"Physical equipment receipt recorded.":
                stockTask.kind==="issue"?(issueType==="routine"?"Routine-care task created. Staff can complete it without Manager approval.":
                        "Equipment flagged unavailable. The booking remains pending preparation; available stock will be rechecked on release."):
                    stockTask.kind==="routine"?"Routine care completed. The units are now available again.":
                        "Repair completion submitted to Manager for stock-release approval.");
            setStockTask(null);
        } catch(error){setSubmitError(error instanceof Error?error.message:"Unable to save rental operation.");}
    };
    return <div className="space-y-4" aria-label="Staff Rental Inventory">
        {!canOperate&&<p role="status" className="rounded-xl border border-[#E6DDF0] bg-[#F7F1FF] px-4 py-3 text-xs text-[#5330B6]">View-only Inventory access: equipment activity is visible, but receiving, rental handover, returns, and condition changes require Full access.</p>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
            {title:"Ready for Release",num:ready,caption:`${readyTasks.reduce((s,x)=>s+x.item.quantity,0)} units prepared for handover`,icon:<Truck size={19}/>},
            {title:"For Return Today / Overdue",num:forReturn,caption:`${returnTasks.reduce((s,x)=>s+x.item.quantity,0)} units due · count shows tasks`,icon:<CalendarClock size={19}/>},
            {title:"Pending Inspection",num:inspection,caption:`${inspectionUnits} units on hold · count shows tasks`,icon:<ClipboardCheck size={19}/>},
            {title:"Needs Cleaning",num:cleaning,caption:"Equipment held until cleaning is recorded",icon:<Sparkles size={19}/>},
        ].map(c=><div key={c.title} className="rounded-2xl border border-[#E6DDF0] bg-white p-3 shadow-sm"><div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold text-[#21132E]">{c.title}</p><span className="rounded-full bg-[#F1EBFF] p-2 text-[#5A35A5]">{c.icon}</span></div><p className="mt-3 text-2xl font-bold text-[#2B174C]">{rental.connected?c.num:"—"}</p><p className="text-[11px] text-[#8A7D90]">{c.caption}</p></div>)}</div>
        <div className="grid gap-4 xl:grid-cols-2">
            <section className={panel}>
                <Header icon={<PackageCheck size={18}/>} title="Supplier Equipment Receiving"
                        subtitle="Confirm actual delivered units from Manager-recorded purchases"/>
                <div className="max-h-[270px] overflow-auto">
                    <table className="w-full text-xs"><thead className="bg-[#FFFDF8]"><tr>{["Purchase No.","Equipment","Pending","Action"].map(h=><th key={h} className={th}>{h}</th>)}</tr></thead>
                        <tbody>{rental.pendingReceipts.map(r=><tr key={r.id} className="border-t border-[#F0EAF4] text-[#2B174C]">
                            <td className="px-3 py-3">{r.purchaseNumber}</td><td className="px-3 py-3">{r.equipmentName}</td>
                            <td className="px-3 py-3">{r.quantityExpected-r.quantityReceived}</td>
                            <td className="px-3 py-3"><button type="button" className={action} disabled={!canOperate} onClick={()=>startStockTask({kind:"receive",id:r.id,label:r.equipmentName,max:r.quantityExpected-r.quantityReceived})}>Receive</button></td>
                        </tr>)}</tbody></table>
                    {rental.connected&&rental.pendingReceipts.length===0&&<Empty>No equipment deliveries awaiting confirmation.</Empty>}
                </div>
            </section>
            <section className={panel}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3.5">
                    <div className="flex items-center gap-3">
                        <span className="rounded-xl bg-[#F1EBFF] p-2 text-[#5A35A5]"><ClipboardCheck size={18}/></span>
                        <div><h3 className="text-[15px] font-bold text-[#21132E]">Equipment Care &amp; Maintenance</h3>
                            <p className="text-[11px] text-[#86778F]">Clean returned equipment, complete routine care, and monitor repairs.</p></div>
                    </div>
                    <span className="rounded-full bg-[#FFF0EF] px-3 py-1 text-[11px] font-semibold text-[#B33B45]">
                        {rental.connected?`${careTasks.length} open ${careTasks.length===1?"task":"tasks"}`:"Loading tasks..."}
                    </span>
                </div>
                <div className="flex flex-wrap gap-2 border-b border-[#F0EAF4] px-4 py-3" aria-label="Equipment care task filters">
                    {([
                        {value:"all",label:"All",count:careTasks.length},
                        {value:"cleaning",label:"Cleaning",count:careTasks.filter(t=>t.kind==="cleaning").length},
                        {value:"routine",label:"Routine Care",count:careTasks.filter(t=>t.kind==="routine").length},
                        {value:"repairs",label:"Repairs",count:careTasks.filter(t=>t.kind==="repairs").length},
                    ] as const).map(f=><button key={f.value} type="button" aria-pressed={careFilter===f.value}
                                               onClick={()=>setCareFilter(f.value)}
                                               className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${careFilter===f.value
                                                   ?"border-[#2B174C] bg-[#2B174C] text-white"
                                                   :"border-[#E4D5FA] bg-white text-[#6F3FD3] hover:bg-[#F7F1FF]"}`}>
                        {f.label} ({f.count})
                    </button>)}
                </div>
                <div className="max-h-[270px] overflow-auto">
                    <table className="w-full min-w-[620px] text-xs">
                        <thead className="sticky top-0 z-[1] bg-[#FFFDF8]"><tr>
                            {["Equipment","Work Item / Reference","Units","Status","Action"].map(h=><th key={h} className={th}>{h}</th>)}
                        </tr></thead>
                        <tbody>{visibleCareTasks.map(task=><tr key={task.key} className="border-t border-[#F0EAF4] text-[#2B174C]">
                            <td className="px-3 py-3 font-medium">{task.equipmentName}</td>
                            <td className="px-3 py-3">
                                <div className="font-medium">{task.kind==="cleaning"?"Clean returned equipment":
                                    task.kind==="routine"?"Routine cleaning / upkeep":"Repair / safety review"}</div>
                                <div className="mt-1 max-w-[200px] break-all text-[10px] text-[#86778F]">{task.reference}</div>
                            </td>
                            <td className="px-3 py-3 font-semibold tabular-nums">{task.units}</td>
                            <td className="px-3 py-3">
                                {task.kind==="cleaning"?<span className="inline-flex rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">Needs Cleaning</span>:
                                    task.kind==="routine"?<span className="inline-flex rounded-full bg-[#F1EBFF] px-2 py-1 text-[10px] font-semibold text-[#5330B6]">Routine Care</span>:
                                        <span className="inline-flex rounded-full bg-[#FFF0EF] px-2 py-1 text-[10px] font-semibold text-[#A43D48]">
                                        {!task.maintenance.repairApproved?"Manager Approval":task.maintenance.pendingUnits>0?"Under Review":"Repair Approved"}
                                    </span>}
                            </td>
                            <td className="px-3 py-3">
                                {task.kind==="cleaning"?<button type="button" className={action} disabled={!canOperate||rental.saving}
                                                                onClick={()=>openRentalAction(task.allocation)}>Mark Cleaned</button>:
                                    task.kind==="routine"?<button type="button" className={action} disabled={!canOperate||rental.saving||task.units<1}
                                                                  onClick={()=>startStockTask({kind:"routine",id:task.maintenance.id,label:task.equipmentName,max:task.units})}>Mark Care Done</button>:
                                        task.maintenance.repairApproved&&task.maintenance.pendingUnits===0&&task.units>0?
                                            <button type="button" className={action} disabled={!canOperate||rental.saving}
                                                    onClick={()=>startStockTask({kind:"complete",id:task.maintenance.id,label:task.equipmentName,max:task.units})}>Report Complete</button>:
                                            <span className="text-[11px] text-[#86778F]">Awaiting Manager</span>}
                            </td>
                        </tr>)}</tbody>
                    </table>
                    {rental.connected&&visibleCareTasks.length===0&&<Empty>{careFilter==="all"?
                        "No equipment care or repair tasks are pending.":"No matching equipment care tasks."}</Empty>}
                </div>
                <p className="border-t border-[#F0EAF4] px-4 py-2 text-[11px] text-[#806A8C]">
                    Staff may finish cleaning and routine upkeep. Damaged equipment stays on hold until approved through the Manager repair workflow.
                </p>
            </section>
        </div>
        {rental.error&&<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Rental operations unavailable: {rental.error} <button type="button" className="underline" onClick={()=>void rental.refresh(true)}>Retry</button></p>}
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
            <section className={panel}><Header icon={<ClipboardList size={18}/>} title="Rental Operations Queue" subtitle="Booking actions: prepare, release, receive return, then inspect"
                                               right={<select aria-label="Filter rental tasks" className={action} value={taskFilter} onChange={e=>setTaskFilter(e.target.value as typeof taskFilter)}>
                                                   <option value="all">All Tasks</option><option value="prepare">Prepare</option><option value="release">Release</option><option value="return">Returns</option><option value="inspect">Inspect</option>
                                               </select>}/>
                <div className="flex flex-wrap gap-2 border-b border-[#F0EAF4] px-4 py-3" aria-label="Filter booking tasks by urgency">
                    {(["all","today","upcoming","overdue"] as const).map(bucket=>{
                        const count=bookingTasks.filter(x=>bucket==="all"||taskBucket(x.item,x.type!,today)===bucket).length;
                        return <button type="button" key={bucket} onClick={()=>setTimeFilter(bucket)} aria-pressed={timeFilter===bucket}
                                       className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${timeFilter===bucket
                                           ?"border-[#2B174C] bg-[#2B174C] text-white":"border-[#E4D5FA] bg-white text-[#6F3FD3] hover:bg-[#F7F1FF]"}`}>
                            {bucket==="all"?"All":timeBucketLabel[bucket]} ({count})
                        </button>;
                    })}
                </div>
                <div className="max-h-[350px] overflow-auto"><table className="w-full min-w-[560px] text-xs"><thead className="sticky top-0 bg-[#FFFDF8]"><tr>{["Booking Ref.","Equipment","Qty","Due","Task","Action"].map(h=><th className={th} key={h}>{h}</th>)}</tr></thead><tbody>
                {visibleTasks.slice(0,50).map(({item,type})=><tr key={item.allocationId} className="border-t border-[#F0EAF4] text-[#2B174C]"><td className="px-3 py-3">{item.bookingReference}</td><td className="px-3 py-3 font-medium">{item.equipmentName}</td><td className="px-3 py-3">{item.quantity}</td><td className="px-3 py-3">{type==="return"?item.endDate:item.startDate}</td><td className="px-3 py-3">{type&&taskLabel[type]}</td><td className="px-3 py-3"><button type="button" className={action} disabled={!canOperate||(type==="release"&&item.startDate>today)}
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     title={type==="release"&&item.startDate>today?`Can release starting ${item.startDate}`:taskHelp[type||"prepare"]}
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     onClick={()=>openRentalAction(item)}>{type==="release"&&item.startDate>today?`Release ${item.startDate}`:taskLabel[type||"prepare"]}</button></td></tr>)}
                </tbody></table>{rental.connected&&visibleTasks.length===0&&<Empty>No matching booking tasks. Select All Tasks and All urgency filters, or confirm a booking with rental equipment.</Empty>}</div>
                <p className="border-t border-[#F0EAF4] px-4 py-2 text-[11px] text-[#806A8C]">Staff confirms booking movements through inspection. Returned units needing cleaning move into Equipment Care &amp; Maintenance; damaged units require Manager review. To report a problem before handover, use Report Issue.</p>
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
            <div className="max-h-[420px] overflow-auto"><table className="w-full min-w-[700px] text-xs"><thead className="sticky top-0 bg-[#FFFDF8]"><tr>{["Equipment No.","Equipment","Category","Total","Physically Available","Out","On Hold","Missing","Action"].map(h=><th className={th} key={h}>{h}</th>)}</tr></thead><tbody>{visibleEquipment.map(e=><tr key={e.id} className="border-t border-[#F0EAF4] text-[#2B174C]"><td className="px-3 py-3">{e.equipmentNumber||"—"}</td><td className="px-3 py-3 font-medium">{e.name}</td><td className="px-3 py-3">{e.category}</td><td className="px-3 py-3">{e.totalUnits}</td><td className="px-3 py-3">{Math.max(0,e.totalUnits-e.rentedOutUnits-e.maintenanceUnits-e.missingUnits)}</td><td className="px-3 py-3">{e.rentedOutUnits}</td><td className="px-3 py-3">{e.maintenanceUnits}</td><td className="px-3 py-3">{e.missingUnits}</td><td className="px-3 py-3"><button className={action} onClick={()=>setViewEquipment(e.id)}><Eye size={15}/> View</button>
                <button type="button" className={`${action} ml-2`} onClick={()=>openSchedule(e.id)}><CalendarDays size={15}/> View Schedule</button>
                <button type="button" className={`${action} ml-2`} disabled={!canOperate||e.totalUnits-e.rentedOutUnits-e.maintenanceUnits-e.missingUnits<=0}
                        onClick={()=>startStockTask({kind:"issue",id:e.id,label:e.name,
                            max:Math.max(0,e.totalUnits-e.rentedOutUnits-e.maintenanceUnits-e.missingUnits)})}>Report Issue</button></td></tr>)}</tbody></table>{rental.connected&&visibleEquipment.length===0&&<Empty>No rental equipment found in this branch.</Empty>}</div>
            <p className="px-4 py-2 text-[11px] text-[#806A8C]">This table shows physical equipment belonging to the branch. On Hold includes inspection, cleaning, and repairs; Missing is tracked separately. View Schedule shows booking-date reservations, not physical release. Release equipment only through a confirmed booking.</p>
        </section>
        {scheduleEquipmentId!==null&&<div role="presentation" className="fixed inset-0 z-[100] flex items-center justify-center bg-[#21132E]/50 p-4"
                                          onMouseDown={e=>{if(e.target===e.currentTarget)setScheduleEquipmentId(null);}}>
            <section role="dialog" aria-modal="true" aria-label="Rental equipment booking schedule"
                     className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
                <div className="flex items-center justify-between gap-2">
                    <div><h3 className="text-lg font-bold text-[#21132E]">View Equipment Schedule</h3>
                        <p className="text-xs text-[#86778F]">{equipmentById.get(scheduleEquipmentId)?.name||"Rental equipment"} · {branchName}</p></div>
                    <button type="button" aria-label="Close schedule" onClick={()=>setScheduleEquipmentId(null)}><X size={19}/></button>
                </div>
                <label className="block space-y-1 text-xs font-semibold text-[#5A476A]">Select booking date
                    <input type="date" min={today} value={scheduleDate} onChange={e=>setScheduleDate(e.target.value)}
                           className="w-full rounded-xl border border-[#E6DDF0] p-3 text-sm"/>
                </label>
                {scheduleLoading&&<p role="status" className="text-sm text-[#86778F]">Checking confirmed reservations for this date...</p>}
                {scheduleError&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{scheduleError}</p>}
                {schedule&&!scheduleLoading&&<>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {[
                            {title:"Total Owned",value:schedule.totalUnits},
                            {title:"Physically Available Now",value:schedule.physicallyAvailableNow},
                            {title:"Reserved / Out on Date",value:schedule.bookedUnits},
                            {title:"Available on Date (est.)",value:schedule.availableOnDate},
                            {title:"On Hold Now",value:schedule.maintenanceUnits},
                            {title:"Missing",value:schedule.missingUnits},
                        ].map(c=><div key={c.title} className="rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-3">
                            <p className="text-[10px] text-[#806A8C]">{c.title}</p><p className="mt-1 text-lg font-bold text-[#2B174C]">{c.value}</p>
                        </div>)}
                    </div>
                    <p className="text-xs text-[#86778F]">Date estimate = total owned − current holds − missing − overlapping confirmed allocations. Current and future quantities may change after returns or new bookings. Overdue checked-out equipment stays blocked for future bookings until physically returned. A confirmed booking does not mean equipment is physically checked out.</p>
                    <div className="rounded-xl border border-[#E6DDF0]">
                        <div className="border-b border-[#E6DDF0] px-3 py-2 text-xs font-semibold">Confirmed allocations on {schedule.date} ({schedule.allocationCount})</div>
                        {schedule.allocationCount>schedule.bookings.length&&<p className="px-3 pt-2 text-xs text-amber-800">Showing the first {schedule.bookings.length} bookings; availability includes all {schedule.allocationCount} allocations.</p>}
                        <div className="max-h-48 overflow-y-auto">
                            {schedule.bookings.length===0?<p className="p-3 text-xs text-[#86778F]">No confirmed allocations cover this date.</p>:
                                schedule.bookings.map(b=><div key={b.allocationId} className="flex items-start justify-between gap-2 border-b border-[#F0EAF4] p-3 text-xs">
                                    <div><p className="break-all font-semibold text-[#2B174C]">{b.bookingReference}</p>
                                        <p className="mt-1 text-[#86778F]">{b.startDate} – {b.endDate} · {b.status==="checked_out"?"Out on Rental":"Reserved"}</p></div>
                                    <strong>{b.quantity} units</strong>
                                </div>)}
                        </div>
                    </div>
                    <p className="text-xs text-[#806A8C]">Staff prepares and releases equipment through the Rental Operations Queue only. Booking confirmation and pricing remain in Booking Management.</p>
                </>}
                <div className="flex justify-end"><button type="button" className={action} onClick={()=>setScheduleEquipmentId(null)}>Close</button></div>
            </section>
        </div>}
        {stockTask&&<div role="presentation" className="fixed inset-0 z-[105] flex items-center justify-center bg-[#21132E]/50 p-4">
            <section role="dialog" aria-modal="true" aria-label="Physical rental equipment task" className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-xl">
                <div className="flex items-center justify-between"><h3 className="text-lg font-bold text-[#21132E]">
                    {stockTask.kind==="receive"?"Confirm Supplier Delivery":stockTask.kind==="issue"?"Report Equipment Issue":
                        stockTask.kind==="routine"?"Complete Routine Care":"Report Repair Completion"}
                </h3><button type="button" disabled={rental.saving} onClick={()=>setStockTask(null)} aria-label="Close"><X size={19}/></button></div>
                <p className="text-sm text-[#5A476A]">{stockTask.label}</p>
                {stockTask.kind==="issue"&&stockTask.bookingReference&&<p className="rounded-lg bg-[#F7F1FF] p-2 text-xs text-[#56378B]">Found while preparing booking <strong>{stockTask.bookingReference}</strong>. The issue is recorded against available equipment; the booking's allocated quantity is not silently changed.</p>}
                <label className="block space-y-1 text-xs font-semibold text-[#5A476A]">Quantity (maximum {stockTask.max})
                    <input type="number" min={1} max={stockTask.max} step={1} value={stockQuantity} onChange={e=>setStockQuantity(e.target.value)}
                           className="w-full rounded-xl border border-[#E6DDF0] p-3 text-sm"/></label>
                {stockTask.kind==="issue"&&<label className="block space-y-1 text-xs font-semibold text-[#5A476A]">Issue type
                    <select value={issueType} onChange={e=>setIssueType(e.target.value as typeof issueType)} className="w-full rounded-xl border border-[#E6DDF0] p-3 text-sm">
                        <option value="routine">Routine Cleaning / Minor Upkeep (no safety issue)</option>
                        <option value="damage">Damaged / Needs Inspection (Manager approval)</option><option value="missing">Missing Equipment</option>
                    </select></label>}
                {stockTask.kind!=="receive"&&<label className="block space-y-1 text-xs font-semibold text-[#5A476A]">
                    {stockTask.kind==="issue"?"Condition / care details":stockTask.kind==="routine"?"Completed routine work":"Completed repair details"}
                    <textarea rows={3} maxLength={500} value={stockNotes} onChange={e=>setStockNotes(e.target.value)}
                              className="w-full rounded-xl border border-[#E6DDF0] p-3 text-sm" placeholder="Describe what was found or repaired..."/></label>}
                <p className="text-xs text-[#86778F]">{stockTask.kind==="receive"?"Only confirmed delivered units are added to rental stock. Purchase costs and supplier payments remain Manager-controlled.":
                    stockTask.kind==="issue"?(issueType==="routine"?
                            "Routine is for cleaning and non-safety upkeep only. Broken, unstable, electrical, or unsafe equipment must be reported as Damaged. Units remain on hold until Staff marks routine care complete.":
                            "Damaged or missing units become unavailable immediately. Manager reviews repairs and missing-unit write-offs."):
                        stockTask.kind==="routine"?"Only routine cleaning and non-safety upkeep can be completed here. Significant damage requires Manager approval.":
                            "Completed units remain on hold until the Manager approves their release."}</p>
                {submitError&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{submitError}</p>}
                <div className="flex justify-end gap-2"><button type="button" className={action} onClick={()=>setStockTask(null)} disabled={rental.saving}>Cancel</button>
                    <button type="button" className={primary} onClick={()=>void performStock()} disabled={rental.saving}>{rental.saving?"Saving...":"Confirm"}</button></div>
            </section>
        </div>}
        {notice&&<div role="status" className="fixed bottom-5 right-5 z-[110] max-w-sm rounded-xl border border-green-200 bg-white p-4 text-sm text-green-800 shadow-lg">{notice}<button onClick={()=>setNotice("")} className="ml-3 underline">Dismiss</button></div>}
        {(selected||selectedEquipment)&&<div role="presentation" className="fixed inset-0 z-[90] flex items-center justify-center bg-[#21132E]/50 p-4" onMouseDown={e=>{if(e.target===e.currentTarget&&!rental.saving){setSelected(null);setViewEquipment(null);}}}>
            <section role="dialog" aria-modal="true" aria-label="Rental operation review" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
                <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-bold text-[#21132E]">{selected?taskLabel[taskType(selected)||"prepare"]:selectedEquipment?.name}</h3><button aria-label="Close dialog" disabled={rental.saving} onClick={()=>{setSelected(null);setViewEquipment(null);}}><X size={19}/></button></div>
                {selected?<div className="mt-4 space-y-3 text-sm"><p className="font-semibold">{selected.equipmentName} · {selected.quantity} booked units</p><p>Confirmed booking: <strong>{selected.bookingReference}</strong></p><p>Rental period: {selected.startDate} – {selected.endDate}</p>
                    <p className="rounded-lg bg-[#F7F1FF] px-3 py-2 text-xs text-[#4D2B85]">Units for this action: <strong>{taskType(selected)==="inspect"?selected.returnedReceivedUnits:taskType(selected)==="clean"?selected.cleaningUnits:taskType(selected)==="damage"?selected.damagedUnits:selected.quantity}</strong></p>
                    <div className="rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-3">
                        <p className="text-[11px] font-semibold text-[#2B174C]">Booking equipment workflow</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {workflowStages.map((stage,index)=><span key={stage} className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${taskType(selected)!=="damage"&&stageForTask[taskType(selected) as Exclude<TaskType,"damage">]===index
                                ?"bg-[#4D2B85] text-white":"bg-white text-[#86778F]"}`}>{stage}</span>)}
                        </div>
                        <p className="mt-2 text-xs text-[#6F5B7E]">{taskHelp[taskType(selected)||"prepare"]}</p>
                    </div>
                    {(taskType(selected)==="prepare"||taskType(selected)==="release")&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                        <p className="font-semibold">Found broken, dirty, or missing equipment before handover?</p>
                        <p className="mt-1">Report the affected available units first. They become unavailable or flagged missing, and this booking stays in its current stage. Stock is checked again before preparation and release. Obtain safe replacements if needed.</p>
                        <button type="button" className={`${action} mt-2`} disabled={!canOperate||rental.saving}
                                onClick={()=>reportIssueBeforeRelease(selected)}><AlertTriangle size={14}/> Report Equipment Issue</button>
                    </div>}
                    {taskType(selected)==="return"&&<div className="space-y-2 rounded-xl bg-amber-50 p-3 text-xs">
                        <p>Enter any units missing when the equipment is returned. Everything else will be held for inspection, not immediately available.</p>
                        <label className="block font-semibold">Missing units on return (0–{selected.quantity})
                            <input type="number" min={0} max={selected.quantity} step={1} value={returnMissing}
                                   onChange={e=>setReturnMissing(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm"/>
                        </label><p>The Manager must resolve missing-unit reports. Returned equipment will not become available until inspected.</p>
                    </div>}
                    {taskType(selected)==="inspect"&&<div className="space-y-2 rounded-xl border border-[#E6DDF0] p-3">
                        <p className="text-xs font-semibold">Record condition of {selected.returnedReceivedUnits??selected.quantity} returned units</p>
                        <p className="text-xs text-[#86778F]">Split the items between good, cleaning, and damaged. The quantities must add up to the returned units.</p>
                        <div className="grid grid-cols-3 gap-2">{([
                            {label:"Good",value:goodUnits,set:setGoodUnits},
                            {label:"Needs Cleaning",value:cleaningUnits,set:setCleaningUnits},
                            {label:"Damaged",value:damagedUnits,set:setDamagedUnits},
                        ] as const).map(field=><label key={field.label} className="block text-[11px] font-semibold">{field.label}
                            <input type="number" min={0} max={selected.returnedReceivedUnits??selected.quantity} step={1}
                                   value={field.value} onChange={e=>field.set(e.target.value)}
                                   className="mt-1 w-full rounded-lg border border-[#E6DDF0] p-2 text-sm"/>
                        </label>)}</div>
                        <p className="text-xs text-[#86778F]">Good units become available. Cleaning and damaged units remain on hold. Damaged units require Manager approval before release.</p>
                    </div>}
                    {taskType(selected)==="damage"&&<div className="rounded-lg bg-amber-50 p-3 text-xs"><AlertTriangle size={16} className="inline"/> Damaged units remain on hold until Manager approval and repair completion.</div>}
                    {taskType(selected)!=="damage"&&<label className="block text-xs font-semibold">Notes
                        {(taskType(selected)==="inspect"&&Number(damagedUnits)>0)||(taskType(selected)==="return"&&Number(returnMissing)>0)?" (required for damaged/missing units)":" (optional)"}
                        <textarea className="mt-1 w-full rounded-xl border p-3 text-sm" maxLength={400} rows={3}
                                  value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Condition, missing accessories, handover notes..."/></label>}
                    {submitError&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{submitError}</p>}
                    <div className="flex justify-end gap-2"><button className={action} disabled={rental.saving} onClick={()=>setSelected(null)}>Cancel</button>{taskType(selected)!=="damage"&&<button className={primary} disabled={rental.saving} onClick={()=>void perform()}>{rental.saving?"Saving...":taskType(selected)==="prepare"?"Confirm Preparation":"Confirm "+taskLabel[taskType(selected)||"prepare"]}</button>}</div>
                </div>:selectedEquipment&&<div className="mt-4 space-y-2 text-sm"><p>Equipment No.: {selectedEquipment.equipmentNumber}</p><p>Total units: {selectedEquipment.totalUnits}</p><p>Out: {selectedEquipment.rentedOutUnits}</p><p>On Hold: <strong>{selectedEquipment.maintenanceUnits}</strong></p>
                    {(()=>{
                        const h=holdBreakdown.get(selectedEquipment.id)||{inspection:0,cleaning:0,routine:0,repairs:0};
                        const known=h.inspection+h.cleaning+h.routine+h.repairs;
                        const other=Math.max(0,selectedEquipment.maintenanceUnits-known);
                        return <div className="rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-3 text-xs">
                            <p className="font-semibold">Why units are On Hold</p>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                                <span>Pending inspection: <strong>{h.inspection}</strong></span>
                                <span>Needs cleaning: <strong>{h.cleaning}</strong></span>
                                <span>Routine care: <strong>{h.routine}</strong></span>
                                <span>Repair / safety review: <strong>{h.repairs}</strong></span>
                                {other>0&&<span className="col-span-2">Other holds / older records: <strong>{other}</strong></span>}
                            </div>
                            {known>selectedEquipment.maintenanceUnits&&<p role="alert" className="mt-2 text-red-700">Hold task quantities exceed the equipment hold total. Ask the Manager to reconcile records.</p>}
                            <p className="mt-2 text-[#86778F]">Known tasks from the current workspace; older or additional records may require Manager review. Returned equipment stays in the booking queue until inspected.</p>
                        </div>;
                    })()}
                    <p>Missing: {selectedEquipment.missingUnits}</p>
                    <p className="font-semibold">Check: {selectedEquipment.totalUnits} owned = {Math.max(0,selectedEquipment.totalUnits-selectedEquipment.rentedOutUnits-selectedEquipment.maintenanceUnits-selectedEquipment.missingUnits)} available + {selectedEquipment.rentedOutUnits} out + {selectedEquipment.maintenanceUnits} held + {selectedEquipment.missingUnits} missing.</p><p className="rounded-lg bg-[#F7F3FC] p-3 text-xs">Product catalog and rental pricing are managed by the Manager.</p></div>}
            </section>
        </div>}
    </div>;
}