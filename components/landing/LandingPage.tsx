"use client";

import Image from "next/image";
import { Lora } from "next/font/google";
import { useEffect, useState } from "react";
import {
    ArrowRight,
    BarChart3,
    Boxes,
    CalendarClock,
    CalendarDays,
    Check,
    CheckCircle2,
    Clock3,
    CreditCard,
    Menu,
    Package,
    Search,
    ShieldCheck,
    Sparkles,
    Store,
    Users,
    X,
    LockKeyhole,
    LogIn,
    UserRound,
} from "lucide-react";


import AuthModal from "./AuthModal";




const lora = Lora({
    subsets: ["latin"],
    weight: ["600", "700"],
    display: "swap",
});

type AuthMode = "login" | "signup" | null;

type PricingPlan = {
    id: number;
    name: string;
    label: string;
    price: string;
    amount: number;
    period: string;
    description: string;
    features: string[];
    buttonText: string;
    highlighted?: boolean;
};

function formatPlanPrice(amount: number) {
    return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

function limitText(value: number | null, noun: string) {
    return value == null ? `Unlimited ${noun}` : `Up to ${value.toLocaleString("en-PH")} ${noun}`;
}

function buildPublicPlan(plan: {
    id: number;
    name: string;
    price: number;
    max_inventory: number | null;
    max_bookings: number | null;
    max_staff: number | null;
    max_branches: number | null;
    has_low_stock_alerts: boolean;
    has_analytics: boolean;
    has_forecasting: boolean;
    has_multi_store: boolean;
}): PricingPlan {
    const normalizedName = plan.name.toLowerCase();
    const isStarter = plan.price === 0 || normalizedName.includes("starter");
    const isBusiness = normalizedName.includes("business");

    const features = [
        "Inventory and product catalog",
        "Booking management",
        "Basic POS and sales recording",
        limitText(plan.max_inventory, "inventory items"),
        limitText(plan.max_bookings, "bookings per month"),
        limitText(plan.max_staff, "staff accounts"),
        limitText(plan.max_branches, "branches"),
        ...(plan.has_low_stock_alerts ? ["Low-stock notifications"] : []),
        ...(plan.has_analytics ? ["Business analytics and reports"] : []),
        ...(plan.has_forecasting ? ["Sales forecasting"] : []),
        ...(plan.has_multi_store ? ["Multi-store access"] : []),
    ];

    return {
        id: plan.id,
        name: plan.name,
        label: isStarter ? "Free" : isBusiness ? "Standard" : "Advanced",
        price: formatPlanPrice(plan.price),
        amount: plan.price,
        period: "/month",
        description: isStarter
            ? "A simple starting plan with the essential tools for your business."
            : `A ${isBusiness ? "standard" : "advanced"} plan with limits and features configured by the platform administrator.`,
        features,
        buttonText: isStarter ? `Use ${plan.name}` : `Choose ${plan.name}`,
        highlighted: isBusiness,
    };
}


const heroHighlights = [
    {
        title: "Inventory",
        detail: "Products, stock levels & alerts",
        icon: Boxes,
        position: "left-[3%] top-[5%] lg:-left-1 xl:-left-3",
        animationDelay: "0s",
    },
    {
        title: "Booking",
        detail: "Schedules, plans & payments",
        icon: CalendarDays,
        position: "right-[3%] top-[6%] lg:-right-1 xl:-right-3",
        animationDelay: "0.8s",
    },
    {
        title: "POS",
        detail: "Sales, orders & transactions",
        icon: CreditCard,
        position: "bottom-[5%] left-[4%] lg:left-0",
        animationDelay: "1.6s",
    },
    {
        title: "Scheduled Order",
        detail: "Future pickup & delivery",
        icon: CalendarClock,
        position: "bottom-[5%] right-[4%] lg:right-0",
        animationDelay: "2.4s",
    },
];

const howItWorksGuides = [
    {
        id: "guide-dashboard",
        title: "Dashboard",
        icon: BarChart3,
        keywords: ["summary", "revenue", "trends", "alerts", "performance"],
        steps: [
            "Open the Dashboard after logging in to view the business summary available for your user role.",
            "Review revenue, bookings, products, staff, branches, recent activity, trends, and inventory alerts.",
            "Use the summary cards and charts to identify items or business areas that need attention.",
            "Open the related module from the dashboard whenever you need to review or update a record.",
        ],
    },
    {
        id: "guide-booking-portal",
        title: "Booking Link / Bookings Portal",
        icon: ArrowRight,
        keywords: ["booking link", "customer portal", "public booking", "packages"],
        steps: [
            "Open the Booking Link or Bookings Portal settings and copy the public booking link for your business.",
            "Share the link with customers so they can view available plans and booking information.",
            "Customers can enter their contact details, event schedule, selected package, and other required information.",
            "Review newly submitted requests in the Bookings module before confirming the reservation.",
        ],
    },
    {
        id: "guide-bookings",
        title: "Bookings",
        icon: CalendarDays,
        keywords: ["reservations", "events", "payments", "balances", "schedule"],
        steps: [
            "Open the Bookings module to view customer reservations, event dates, and booking statuses.",
            "Create or open a booking, then complete the customer, schedule, package, and payment information.",
            "Update the booking progress as it moves from pending to confirmed, completed, or cancelled.",
            "Review balances, payment history, selected items, and booking notes before completing the transaction.",
        ],
    },
    {
        id: "guide-scheduled-orders",
        title: "Scheduled Orders",
        icon: CalendarClock,
        keywords: ["future order", "delivery", "pickup", "reservation", "order schedule"],
        steps: [
            "Open Scheduled Orders to view orders arranged for a future date and time.",
            "Create a scheduled order and enter the customer, selected products or package, quantity, and payment information.",
            "Choose the required pickup, delivery, or preparation schedule and add any important order instructions.",
            "Update the order status as it moves from scheduled to preparing, ready, released, delivered, completed, or cancelled.",
            "Review upcoming orders regularly so inventory and staff can be prepared before the scheduled date.",
        ],
    },
    {
        id: "guide-inventory",
        title: "Inventory",
        icon: Boxes,
        keywords: ["products", "categories", "stock", "low stock", "upload"],
        steps: [
            "Add products and complete the product name, category, price, quantity, and stock-alert fields.",
            "Use Manage Categories to organize products into the correct inventory groups.",
            "Update product quantities whenever new stock arrives or items are used for bookings, scheduled orders, and sales.",
            "Review inventory value, low-stock alerts, and out-of-stock items so products can be restocked on time.",
            "Use the product upload option when you need to add inventory records from a supported file.",
        ],
    },
    {
        id: "guide-plans",
        title: "Packages",
        icon: Package,
        keywords: ["package price", "down payment", "included items", "availability"],
        steps: [
            "Open Packages and create a new package for the services or items offered by the business.",
            "Enter the package name, price, required down payment, duration, availability, and description.",
            "Add all products, services, or inclusions that customers will receive with the package.",
            "Save the package and confirm that it appears correctly in the Bookings Portal.",
            "Edit or deactivate a package whenever its price, inclusions, or availability changes.",
        ],
    },
    {
        id: "guide-sales",
        title: "Sales / POS",
        icon: CreditCard,
        keywords: ["sale", "checkout", "payment", "receipt", "order"],
        steps: [
            "Open Sales or POS and select the products included in the customer order.",
            "Review the quantities and prices, then let the system calculate the total amount.",
            "Record the payment method and amount received before confirming the transaction.",
            "Complete the sale and review the transaction in the sales history.",
            "Confirm that sold product quantities were deducted correctly from inventory.",
        ],
    },
    {
        id: "guide-analytics",
        title: "Analytics",
        icon: BarChart3,
        keywords: ["growth", "peak days", "peak times", "business performance"],
        steps: [
            "Open Analytics to review sales growth, booking trends, and overall business performance.",
            "Compare performance across selected dates, branches, products, plans, or booking periods.",
            "Identify peak booking days and times to help plan staffing and business operations.",
            "Use the results to improve promotions, schedules, plans, and inventory decisions.",
        ],
    },
    {
        id: "guide-forecasting",
        title: "Forecasting",
        icon: Clock3,
        keywords: ["demand", "seasonal trend", "stock risk", "prediction"],
        steps: [
            "Open Forecasting and select the available inventory, booking, or seasonal forecast.",
            "Choose the period and records that should be included in the forecast.",
            "Run the forecast to identify possible high-demand products, busy booking periods, and stock risks.",
            "Review the result together with current inventory and confirmed bookings.",
            "Use the forecast as planning support and continue checking actual business records before making decisions.",
        ],
    },
    {
        id: "guide-reports",
        title: "Reports",
        icon: BarChart3,
        keywords: ["inventory report", "sales report", "booking history", "staff activity"],
        steps: [
            "Open Reports and select the report type you need to review.",
            "Choose the date range, branch, status, or other available report filters.",
            "Review inventory, restock, booking, sales, forecasting, or staff activity records.",
            "Use the report information for monitoring, documentation, and business planning.",
        ],
    },
    {
        id: "guide-branches",
        title: "Branches",
        icon: Store,
        keywords: ["branch revenue", "branch bookings", "setup", "performance"],
        steps: [
            "Open Branches to view every branch connected to the owner account.",
            "Review each branch name, setup status, revenue, bookings, and available performance information.",
            "Open a branch record when you need to review or update its business details.",
            "Compare branch activity to identify locations that may need inventory, staffing, or operational support.",
        ],
    },
    {
        id: "guide-team-management",
        title: "Team Management",
        icon: Users,
        keywords: [
            "branch manager",
            "staff management",
            "employee",
            "permissions",
            "module access",
            "assigned branch",
            "activate",
            "deactivate",
        ],
        steps: [
            "Open Team Management to view branch managers and staff members in one organized table.",
            "Review each person's role, assigned branch, account status, and module permissions.",
            "Owners can activate or deactivate branch managers and update the access assigned to each manager.",
            "Managers can add staff members and select which modules each staff account can use.",
            "Update or deactivate access whenever a person's branch, responsibility, or employment status changes.",
        ],
    },
];

const navigationItems = [
    { label: "Home", href: "#home", sectionId: "home" },
    { label: "About", href: "#about", sectionId: "about" },
    { label: "Features", href: "#features", sectionId: "features" },
    { label: "Pricing", href: "#pricing", sectionId: "pricing" },
    {
        label: "How It Works",
        href: "#how-it-works",
        sectionId: "how-it-works",
    },
    { label: "FAQ", href: "#faq", sectionId: "faq" },
    { label: "Contacts", href: "#contact", sectionId: "contact" },
];

export default function LandingPage({
                                        onSignupSuccess,
                                    }: {
    onSignupSuccess: () => void;
}) {
    const [authMode, setAuthMode] = useState<AuthMode>(null);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [guideSearch, setGuideSearch] = useState("");
    const [activeSection, setActiveSection] = useState("home");

    const [selectedPlan, setSelectedPlan] =
        useState<PricingPlan | null>(null);

    const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] =
        useState(false);
    const [pricingPlans, setPricingPlans] = useState<PricingPlan[]>([]);
    const [pricingLoading, setPricingLoading] = useState(true);
    const [pricingError, setPricingError] = useState("");

    const handleSelectPlan = (plan: PricingPlan) => {
        setSelectedPlan(plan);
        setIsSubscriptionModalOpen(true);
    };

    const handleCloseSubscriptionModal = () => {
        setIsSubscriptionModalOpen(false);
        setSelectedPlan(null);
    };

    const handlePlanAuthentication = (mode: Exclude<AuthMode, null>) => {
        if (selectedPlan) {
            sessionStorage.setItem(
                "pending_plan",
                JSON.stringify({
                    plan_id: selectedPlan.id,
                    plan_name: selectedPlan.name,
                }),
            );
        }

        setIsSubscriptionModalOpen(false);
        setAuthMode(mode);
    };

    useEffect(() => {
        let cancelled = false;

        async function loadPricingPlans() {
            setPricingLoading(true);
            setPricingError("");

            try {
                const response = await fetch("/api/subscription-admin/plans", { cache: "no-store" });
                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    throw new Error(data.message || "Unable to load pricing plans.");
                }

                if (!cancelled) {
                    setPricingPlans((data.plans || []).map(buildPublicPlan));
                }
            } catch (error) {
                if (!cancelled) {
                    setPricingError(
                        error instanceof Error
                            ? error.message
                            : "Unable to load pricing plans.",
                    );
                }
            } finally {
                if (!cancelled) setPricingLoading(false);
            }
        }

        loadPricingPlans();

        return () => {
            cancelled = true;
        };
    }, []);


    const normalizedGuideSearch = guideSearch.trim().toLowerCase();

    const filteredHowItWorksGuides = howItWorksGuides.filter((guide) => {
        if (!normalizedGuideSearch) {
            return true;
        }

        const searchableText = [
            guide.title,
            ...guide.keywords,
            ...guide.steps,
        ]
            .join(" ")
            .toLowerCase();

        return searchableText.includes(normalizedGuideSearch);
    });


    useEffect(() => {
        const sections = navigationItems
            .map((item) => document.getElementById(item.sectionId))
            .filter((section): section is HTMLElement => Boolean(section));

        const observer = new IntersectionObserver(
            (entries) => {
                const visibleEntries = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort(
                        (first, second) =>
                            second.intersectionRatio -
                            first.intersectionRatio
                    );

                if (visibleEntries[0]) {
                    setActiveSection(visibleEntries[0].target.id);
                }
            },
            {
                rootMargin: "-28% 0px -58% 0px",
                threshold: [0.01, 0.15, 0.35, 0.6],
            }
        );

        sections.forEach((section) => observer.observe(section));

        return () => observer.disconnect();
    }, []);

    const desktopNavigationClass = (sectionId: string) =>
        [
            "px-3 py-2 transition duration-300",
            activeSection === sectionId
                ? "font-semibold text-[#F1C85C]"
                : "text-white/80 hover:-translate-y-0.5 hover:text-[#F5E8C0]",
        ].join(" ");

    const mobileNavigationClass = (sectionId: string) =>
        [
            "px-4 py-3 text-sm font-medium transition",
            activeSection === sectionId
                ? "font-semibold text-[#F1C85C]"
                : "text-white/85 hover:text-[#F5E8C0]",
        ].join(" ");

    return (
        <main className="min-h-screen overflow-x-hidden bg-[#F7F4FB] font-sans text-[#21172C] antialiased">
            <style jsx global>{`
                @keyframes heroFeatureFloat {
                    0%,
                    100% {
                        transform: translate3d(0, 0, 0);
                    }

                    50% {
                        transform: translate3d(0, -10px, 0);
                    }
                }

                .hero-feature-float {
                    animation: heroFeatureFloat 4.8s ease-in-out infinite;
                    will-change: transform;
                }

                @media (prefers-reduced-motion: reduce) {
                    .hero-feature-float {
                        animation: none !important;
                    }
                }
            `}</style>
            <nav className="fixed left-0 right-0 top-0 z-50 flex h-20 items-center justify-between border-b border-white/10 bg-[#2D1B4E]/90 px-4 shadow-[0_8px_32px_rgba(0,0,0,0.18)] backdrop-blur-xl transition-all duration-300 sm:px-6 lg:px-10">
                <a
                    href="#home"
                    aria-label="StockNBook home"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3"
                >
                    <Image
                        src="/logo.png"
                        alt="StockNBook logo"
                        width={52}
                        height={52}
                        priority
                        className="h-9 w-9 shrink-0 object-contain sm:h-11 sm:w-11"
                    />

                    <span
                        className={`${lora.className} truncate text-lg font-bold tracking-[-0.045em] text-white sm:text-2xl`}
                    >
                        Stock<span className="text-[#D4A126]">N</span>Book
                    </span>
                </a>

                <div className="hidden items-center gap-1 text-xs font-medium md:flex lg:gap-2 lg:text-sm">
                    {navigationItems.map((item) => (
                        <a
                            key={item.sectionId}
                            href={item.href}
                            onClick={() =>
                                setActiveSection(item.sectionId)
                            }
                            aria-current={
                                activeSection === item.sectionId
                                    ? "page"
                                    : undefined
                            }
                            className={desktopNavigationClass(
                                item.sectionId
                            )}
                        >
                            {item.label}
                        </a>
                    ))}
                </div>

                <div className="hidden items-center gap-3 md:flex">
                    <button
                        onClick={() => setAuthMode("login")}
                        className="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white backdrop-blur-md transition duration-300 hover:border-[#F5E8C0] hover:bg-white/10"
                    >
                        Log in
                    </button>

                    <button
                        onClick={() => setAuthMode("signup")}
                        className="rounded-lg bg-[#C9951A] px-4 py-2 text-sm font-medium text-white transition duration-300 hover:bg-[#D8A52A] hover:shadow-lg hover:shadow-[#C9951A]/30"
                    >
                        Get started
                    </button>
                </div>

                <button
                    type="button"
                    aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
                    aria-expanded={isMobileMenuOpen}
                    onClick={() => setIsMobileMenuOpen((current) => !current)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition hover:border-[#F5E8C0]/60 hover:bg-white/10 md:hidden"
                >
                    {isMobileMenuOpen ? (
                        <X className="h-6 w-6" />
                    ) : (
                        <Menu className="h-6 w-6" />
                    )}
                </button>

                {isMobileMenuOpen && (
                    <div className="absolute left-0 right-0 top-20 border-t border-white/10 bg-[#2D1B4E]/95 px-4 py-5 shadow-2xl backdrop-blur-xl md:hidden">
                        <div className="mx-auto flex max-w-md flex-col gap-1">
                            {navigationItems.map((item) => (
                                <a
                                    key={item.sectionId}
                                    href={item.href}
                                    onClick={() => {
                                        setActiveSection(item.sectionId);
                                        setIsMobileMenuOpen(false);
                                    }}
                                    aria-current={
                                        activeSection === item.sectionId
                                            ? "page"
                                            : undefined
                                    }
                                    className={mobileNavigationClass(
                                        item.sectionId
                                    )}
                                >
                                    {item.label}
                                </a>
                            ))}

                            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
                                <button
                                    onClick={() => {
                                        setIsMobileMenuOpen(false);
                                        setAuthMode("login");
                                    }}
                                    className="rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                                >
                                    Log in
                                </button>

                                <button
                                    onClick={() => {
                                        setIsMobileMenuOpen(false);
                                        setAuthMode("signup");
                                    }}
                                    className="rounded-xl bg-[#C9951A] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#D8A52A]"
                                >
                                    Get started
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </nav>

            <section
                id="home"
                className="relative min-h-screen scroll-mt-20 overflow-hidden bg-[radial-gradient(circle_at_18%_22%,_#4D3970_0%,_#2D1B4E_44%,_#211333_100%)] px-5 pb-10 pt-24 sm:px-6 lg:flex lg:h-screen lg:min-h-[680px] lg:items-center lg:px-10 lg:pb-6 lg:pt-24"
            >
                <div className="pointer-events-none absolute -left-40 top-24 h-80 w-80 rounded-full bg-[#7655A5]/15 blur-3xl" />
                <div className="pointer-events-none absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-[#C9951A]/10 blur-3xl" />

                <div className="relative z-10 mx-auto grid w-full max-w-[1480px] items-center gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:gap-5 xl:grid-cols-[0.8fr_1.2fr]">
                    <div className="max-w-[650px] text-center lg:text-left">
                        <div className="mx-auto mb-5 flex w-full items-center justify-center lg:mx-0 lg:justify-start">
                            <span
                                className={`${lora.className} block text-[clamp(3rem,5.8vw,5.8rem)] font-bold leading-[0.9] tracking-[-0.06em] text-white drop-shadow-[0_10px_28px_rgba(0,0,0,0.18)]`}
                            >
                                Stock<span className="text-[#D4A126]">N</span>Book
                            </span>
                        </div>

                        <div className="mx-auto mb-4 inline-flex max-w-full items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-center text-xs font-medium text-[#F5E8C0] shadow-sm backdrop-blur-md lg:mx-0">
                            <Sparkles className="h-3.5 w-3.5" />
                            Built for party supply businesses with booking services.
                        </div>

                        <h1 className="mx-auto max-w-xl text-4xl font-semibold leading-[1.08] tracking-[-0.04em] text-white sm:text-5xl lg:mx-0 lg:text-[3rem] xl:text-[3.35rem]">
                            The business OS for every{" "}
                            <span className="italic text-[#F5E8C0]">celebration.</span>
                        </h1>

                        <p className="mx-auto mt-4 max-w-lg text-sm leading-6 text-white/65 sm:text-[15px] lg:mx-0">
                            Manage bookings, inventory, packages, POS sales, staff
                            access, and business insights in one organized system
                            for party supply businesses with booking services.
                        </p>

                        <div className="mt-6 flex flex-wrap justify-center gap-3 lg:justify-start">
                            <button
                                onClick={() => setAuthMode("signup")}
                                className="inline-flex items-center gap-2 rounded-xl bg-[#C9951A] px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#C9951A]/15 transition hover:-translate-y-0.5 hover:bg-[#D8A52A]"
                            >
                                Get started free
                                <ArrowRight className="h-4 w-4" />
                            </button>

                            <a
                                href="#how-it-works"
                                className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-6 py-3.5 text-sm font-semibold text-white backdrop-blur-md transition hover:-translate-y-0.5 hover:border-[#F5E8C0]/60 hover:bg-white/15"
                            >
                                See how it works
                                <ArrowRight className="h-4 w-4" />
                            </a>
                        </div>
                    </div>

                    <div className="relative mx-auto w-full max-w-[760px] lg:ml-auto lg:mr-0 xl:max-w-[800px]">
                        <div className="absolute inset-x-[14%] bottom-[9%] h-20 rounded-full bg-black/35 blur-3xl" />

                        <div className="relative z-10 flex min-h-[350px] items-center justify-center sm:min-h-[420px] lg:min-h-[470px] xl:min-h-[500px]">
                            <Image
                                src="/laptop_cp.png"
                                alt="StockNBook dashboard displayed on a laptop and mobile phone"
                                width={1500}
                                height={1125}
                                priority
                                className="h-auto w-[92%] object-contain drop-shadow-[0_28px_48px_rgba(0,0,0,0.32)]"
                            />
                        </div>

                        {heroHighlights.map((highlight) => {
                            const HighlightIcon = highlight.icon;

                            return (
                                <HeroFeatureBubble
                                    key={highlight.title}
                                    title={highlight.title}
                                    detail={highlight.detail}
                                    icon={<HighlightIcon className="h-5 w-5" />}
                                    className={highlight.position}
                                    animationDelay={highlight.animationDelay}
                                />
                            );
                        })}

                        <div className="relative z-20 mt-4 grid grid-cols-2 gap-2 sm:hidden">
                            {heroHighlights.map((highlight) => {
                                const HighlightIcon = highlight.icon;

                                return (
                                    <div
                                        key={highlight.title}
                                        className="flex min-h-[74px] items-center gap-2.5 rounded-2xl border border-white/20 bg-white/10 px-3 py-3 text-left shadow-lg backdrop-blur-md"
                                    >
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFF4D9] text-[#C9951A]">
                                            <HighlightIcon className="h-4 w-4" />
                                        </span>

                                        <div className="min-w-0">
                                            <p className="truncate text-xs font-semibold text-white">
                                                {highlight.title}
                                            </p>

                                            <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-white/60">
                                                {highlight.detail}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </section>

            <section
                id="about"
                className="scroll-mt-20 border-b border-[#EADFCB] bg-[#FFF8EA] px-5 py-16 sm:px-6 lg:px-10 lg:py-20"
            >
                <div className="mx-auto max-w-6xl">
                    <div className="mx-auto max-w-3xl text-center">
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#C9951A]">
                            About StockNBook
                        </p>

                        <h2 className="mt-3 text-3xl font-semibold tracking-[-0.025em] text-[#21172C] sm:text-4xl lg:text-5xl">
                            Built to make party supply operations easier to manage
                        </h2>

                        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#706578] sm:text-base">
                            StockNBook brings bookings, inventory, packages,
                            scheduled orders, sales, branches, and team access
                            into one organized platform.
                        </p>
                    </div>

                    <div className="mt-12 grid gap-5 md:grid-cols-3">
                        <article className="rounded-3xl border border-[#E7DCEB] bg-white p-7 shadow-[0_16px_40px_rgba(45,27,78,0.07)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_22px_50px_rgba(45,27,78,0.11)]">
                            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FFF0C5] text-[#C9951A]">
                                <Sparkles className="h-6 w-6" />
                            </span>

                            <h3 className="mt-5 text-lg font-bold tracking-[-0.02em] text-[#21172C]">
                                Why StockNBook was built
                            </h3>

                            <p className="mt-3 text-sm leading-7 text-[#706578]">
                                Party supply businesses often use separate
                                notebooks, spreadsheets, messages, and manual
                                records for bookings, products, payments, and
                                schedules. StockNBook was built to connect those
                                daily tasks, reduce missed updates, and keep
                                important business information in one place.
                            </p>
                        </article>

                        <article className="rounded-3xl border border-[#E7DCEB] bg-white p-7 shadow-[0_16px_40px_rgba(45,27,78,0.07)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_22px_50px_rgba(45,27,78,0.11)]">
                            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F1ECF8] text-[#2D1B4E]">
                                <Users className="h-6 w-6" />
                            </span>

                            <h3 className="mt-5 text-lg font-bold tracking-[-0.02em] text-[#21172C]">
                                Who the system is for
                            </h3>

                            <p className="mt-3 text-sm leading-7 text-[#706578]">
                                StockNBook is designed for party supply and event
                                businesses that accept bookings and manage
                                products or packages. It supports business
                                owners, branch managers, and staff members by
                                giving each role the tools and access needed for
                                their responsibilities.
                            </p>
                        </article>

                        <article className="rounded-3xl border border-[#E7DCEB] bg-white p-7 shadow-[0_16px_40px_rgba(45,27,78,0.07)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_22px_50px_rgba(45,27,78,0.11)]">
                            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF7E9] text-[#4D7A2D]">
                                <CheckCircle2 className="h-6 w-6" />
                            </span>

                            <h3 className="mt-5 text-lg font-bold tracking-[-0.02em] text-[#21172C]">
                                Benefits for the business
                            </h3>

                            <ul className="mt-3 space-y-3 text-sm leading-6 text-[#706578]">
                                {[
                                    "Centralized and easier-to-find business records",
                                    "Faster booking, sales, and scheduled-order workflows",
                                    "Better visibility of stock levels and inventory alerts",
                                    "Clear access control for owners, managers, and staff",
                                    "Reports, analytics, and forecasting for planning",
                                ].map((benefit) => (
                                    <li
                                        key={benefit}
                                        className="flex items-start gap-2.5"
                                    >
                                        <Check className="mt-1 h-4 w-4 shrink-0 text-[#C9951A]" />
                                        <span>{benefit}</span>
                                    </li>
                                ))}
                            </ul>
                        </article>
                    </div>

                    <div className="mx-auto mt-16 max-w-3xl text-center">
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#C9951A]">
                            At a glance
                        </p>

                        <h3 className="mt-3 text-3xl font-semibold tracking-[-0.025em] text-[#21172C] sm:text-4xl">
                            Manage the most important parts of your business
                        </h3>

                        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#706578] sm:text-base">
                            See daily activity, customer schedules, stock alerts,
                            and future orders from one organized system.
                        </p>
                    </div>

                    <div className="relative mt-10">
                        <div className="absolute left-[8%] right-[8%] top-5 hidden border-t border-dashed border-[#BFAFCB] lg:block" />

                        <div className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <ProofStat
                                value="01"
                                label="Dashboard overview"
                                detail="Business summary"
                                icon={<BarChart3 className="h-5 w-5" />}
                            />

                            <ProofStat
                                value="02"
                                label="Booking records"
                                detail="Customer schedules"
                                icon={<CalendarDays className="h-5 w-5" />}
                            />

                            <ProofStat
                                value="03"
                                label="Inventory alerts"
                                detail="Stock monitoring"
                                icon={<Boxes className="h-5 w-5" />}
                            />

                            <ProofStat
                                value="04"
                                label="Scheduled orders"
                                detail="Future fulfillment"
                                icon={<CalendarClock className="h-5 w-5" />}
                            />
                        </div>
                    </div>
                </div>
            </section>

            <section
                id="features"
                className="scroll-mt-20 bg-white px-5 py-20 sm:px-6 lg:px-10"
            >
                <div className="mx-auto max-w-6xl">
                    <SectionHeading
                        eyebrow="What's inside"
                        title="Everything your party supply and booking business needs"
                        description="A complete set of connected tools for bookings, scheduled orders, products, sales, branches, team access, and business performance."
                    />

                    <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <FeatureCard
                            number="01"
                            title="Dashboard"
                            desc="View business summaries such as revenue, bookings, products, staff, branch performance, recent bookings, trends, and inventory alerts based on the user role."
                        />

                        <FeatureCard
                            number="02"
                            title="Booking Link / Bookings Portal"
                            desc="Share a booking link where customers can view available packages and submit booking details through the Bookings Portal."
                        />

                        <FeatureCard
                            number="03"
                            title="Bookings"
                            desc="Manage customer bookings, schedules, selected packages, payment status, balances, booking progress, and booking history."
                        />

                        <FeatureCard
                            number="04"
                            title="Inventory"
                            desc="Manage products, categories, stock levels, inventory value, low-stock alerts, out-of-stock items, and product uploads."
                        />

                        <FeatureCard
                            number="05"
                            title="Packages"
                            desc="Create and manage packages with prices, down payments, included items, duration, availability, and package details shown in the Bookings Portal."
                        />

                        <FeatureCard
                            number="06"
                            title="Sales / POS"
                            desc="Process product sales, add items to customer orders, calculate totals, record payments, and monitor daily sales."
                        />

                        <FeatureCard
                            number="07"
                            title="Analytics"
                            desc="Review sales growth, sales trends, peak booking days, peak booking times, and overall business performance."
                        />

                        <FeatureCard
                            number="08"
                            title="Forecasting"
                            desc="Run demand forecasts for inventory, seasonal trends, and bookings to help identify high-demand items and possible stock risks."
                        />

                        <FeatureCard
                            number="09"
                            title="Reports"
                            desc="Owners can access reports for inventory, restock history, booking history, sales, forecasting, and staff activity."
                        />

                        <FeatureCard
                            number="10"
                            title="Branches"
                            desc="Owners can monitor branch revenue, branch bookings, setup status, and overall branch performance."
                        />

                        <FeatureCard
                            number="11"
                            title="Manager and Staff Management"
                            desc="Owners can manage branch managers, assigned branches, account status, and manager permissions. Managers can add staff members and assign which modules each staff account can access."
                        />

                        <FeatureCard
                            number="12"
                            title="Scheduled Orders"
                            desc="Create and monitor orders arranged for future dates, including customer details, selected items, pickup or delivery schedules, payment status, and order progress."
                        />
                    </div>
                </div>
            </section>

            <PricingSection
                pricingPlans={pricingPlans}
                loading={pricingLoading}
                error={pricingError}
                onSelectPlan={handleSelectPlan}
            />

            <section
                id="how-it-works"
                className="scroll-mt-20 bg-[#FFF9EF] px-5 py-20 sm:px-6 lg:px-10"
            >
                <div className="mx-auto max-w-6xl">
                    <p className="text-center text-xs font-medium uppercase tracking-[0.2em] text-[#C9951A]">
                        How it works
                    </p>

                    <h2 className="mt-3 text-center text-4xl font-semibold tracking-[-0.025em] text-[#21172C] sm:text-5xl">
                        How to use StockNBook
                    </h2>

                    <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-7 text-[#7A6E88] sm:text-base">
                        Search or select a module to view its step-by-step guide.
                    </p>

                    <div className="relative mx-auto mt-8 max-w-2xl">
                        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#7A6E88]" />

                        <input
                            type="search"
                            value={guideSearch}
                            onChange={(event) => setGuideSearch(event.target.value)}
                            placeholder="Search Dashboard, Bookings, Inventory, Scheduled Orders..."
                            aria-label="Search How It Works guides"
                            className="h-14 w-full rounded-2xl border border-[#DED4E8] bg-white pl-12 pr-12 text-sm text-[#21172C] shadow-[0_12px_30px_rgba(45,27,78,0.06)] outline-none transition placeholder:text-[#9B90A4] focus:border-[#2D1B4E] focus:ring-4 focus:ring-[#2D1B4E]/10"
                        />

                        {guideSearch && (
                            <button
                                type="button"
                                onClick={() => setGuideSearch("")}
                                aria-label="Clear guide search"
                                className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[#7A6E88] transition hover:bg-[#EEE8F8] hover:text-[#2D1B4E]"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>

                    <div className="mx-auto mt-6 flex max-w-5xl gap-2 overflow-x-auto pb-2 sm:flex-wrap sm:justify-center">
                        <button
                            type="button"
                            onClick={() => setGuideSearch("")}
                            className={[
                                "shrink-0 rounded-full border px-4 py-2 text-sm font-medium shadow-sm transition",
                                !guideSearch
                                    ? "border-[#2D1B4E] bg-[#2D1B4E] text-white"
                                    : "border-[#E2DAEA] bg-white text-[#2D1B4E] hover:border-[#C9951A] hover:bg-[#FFFBF0]",
                            ].join(" ")}
                        >
                            All guides
                        </button>

                        {howItWorksGuides.map((guide) => (
                            <button
                                key={guide.id}
                                type="button"
                                onClick={() => setGuideSearch(guide.title)}
                                className={[
                                    "shrink-0 rounded-full border px-4 py-2 text-sm font-medium shadow-sm transition",
                                    guideSearch.toLowerCase() ===
                                    guide.title.toLowerCase()
                                        ? "border-[#2D1B4E] bg-[#2D1B4E] text-white"
                                        : "border-[#E2DAEA] bg-white text-[#2D1B4E] hover:border-[#C9951A] hover:bg-[#FFFBF0]",
                                ].join(" ")}
                            >
                                {guide.title}
                            </button>
                        ))}
                    </div>

                    <div className="mx-auto mt-10 max-w-4xl space-y-6">
                        {filteredHowItWorksGuides.length > 0 ? (
                            filteredHowItWorksGuides.map((guide) => {
                                const GuideIcon = guide.icon;

                                return (
                                    <HowItWorksCard
                                        key={guide.id}
                                        id={guide.id}
                                        icon={<GuideIcon className="h-5 w-5" />}
                                        title={guide.title}
                                        steps={guide.steps}
                                    />
                                );
                            })
                        ) : (
                            <div className="rounded-3xl border border-[#E7E0ED] bg-white px-6 py-12 text-center shadow-sm">
                                <Search className="mx-auto h-10 w-10 text-[#B2A8BA]" />

                                <h3 className="mt-4 text-lg font-semibold text-[#1A1220]">
                                    No guide found
                                </h3>

                                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7A6E88]">
                                    Try searching for a module such as Bookings,
                                    Inventory, Scheduled Orders, Packages, or
                                    Reports.
                                </p>

                                <button
                                    type="button"
                                    onClick={() => setGuideSearch("")}
                                    className="mt-5 rounded-xl bg-[#2D1B4E] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#3D2560]"
                                >
                                    Show all guides
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="mx-auto mt-14 max-w-4xl rounded-3xl border border-[#E4DAEC] bg-[linear-gradient(135deg,_#F4EEFA_0%,_#FFF9EA_100%)] px-5 py-10 text-center shadow-[0_20px_60px_rgba(45,27,78,0.08)] sm:px-10 sm:py-14">
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#C9951A]">
                            Start using StockNBook
                        </p>

                        <h3 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-[#21172C] sm:text-4xl">
                            Ready to try it for your own business?
                        </h3>

                        <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-[#7A6E88] sm:text-base">
                            The Starter plan is free. Set up your business,
                            branches, products, packages, bookings, and scheduled
                            orders in just a few steps.
                        </p>

                        <button
                            type="button"
                            onClick={() => setAuthMode("signup")}
                            className="mt-7 inline-flex items-center justify-center gap-2 rounded-xl bg-[#2D1B4E] px-7 py-3.5 text-sm font-medium text-white transition hover:bg-[#3D2560] hover:shadow-lg hover:shadow-[#2D1B4E]/20"
                        >
                            Get started free
                            <ArrowRight className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </section>

            <section
                id="faq"
                className="scroll-mt-20 bg-white px-5 py-20 sm:px-6 lg:px-10"
            >
                <div className="mx-auto max-w-6xl">
                    <SectionHeading
                        eyebrow="Frequently asked questions"
                        title="Questions about StockNBook"
                        description="Clear answers about access, subscriptions, scheduled orders, and managing your business team."
                    />

                    <div className="mt-12 grid gap-4 md:grid-cols-2">
                        <FaqItem
                            number="01"
                            question="Who can use StockNBook?"
                            answer="StockNBook is designed for party supply and event businesses that manage bookings, packages, inventory, scheduled orders, sales, branches, and team members."
                        />

                        <FaqItem
                            number="02"
                            question="Can I start for free?"
                            answer="Yes. The Starter plan lets you begin with the essential tools before upgrading when your business needs higher limits or more advanced features."
                        />

                        <FaqItem
                            number="03"
                            question="Can managers and staff have different access?"
                            answer="Yes. Team Management keeps branch managers and staff in one table while allowing permissions to be assigned based on each person's responsibilities."
                        />

                        <FaqItem
                            number="04"
                            question="How are paid subscriptions activated?"
                            answer="Business and Enterprise subscriptions are activated after the platform administrator verifies the submitted GCash payment proof."
                        />
                    </div>
                </div>
            </section>

            <section
                id="contact"
                className="scroll-mt-20 bg-[#2D1B4E] px-5 py-14 text-white sm:px-6 lg:px-10"
            >
                <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 md:flex-row md:items-center">
                    <div>
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#F1C85C]">
                            Contact us
                        </p>

                        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
                            Ready to organize your party supply and booking business?
                        </h2>

                        <p className="mt-3 max-w-2xl text-sm leading-7 text-white/65 sm:text-base">
                            Start managing bookings, scheduled orders, inventory,
                            packages, sales, branches, and team access with one
                            organized platform.
                        </p>
                    </div>

                    <div className="flex w-full flex-wrap gap-3 md:w-auto">
                        <a
                            href="mailto:support@stocknbook.com"
                            className="flex-1 rounded-xl border border-white/25 bg-white/5 px-6 py-3 text-center text-sm font-medium text-white transition hover:border-[#F1C85C] hover:bg-white/10 md:flex-none"
                        >
                            Contact us
                        </a>

                        <button
                            onClick={() => setAuthMode("signup")}
                            className="flex-1 rounded-xl bg-[#C9951A] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#D8A52A] md:flex-none"
                        >
                            Get started
                        </button>
                    </div>
                </div>
            </section>

            <footer className="border-t border-[#3F2C57] bg-[#241437] px-5 py-8 text-white sm:px-6 lg:px-10">
                <div className="mx-auto max-w-5xl text-center">
                    <p className="text-xs leading-6 text-white/55 sm:text-sm">
                        <span className="font-semibold text-[#F1C85C]">
                            Disclaimer:
                        </span>{" "}
                        StockNBook is a business-management and record-keeping
                        platform for bookings, scheduled orders, inventory,
                        packages, sales, branches, and staff. It is not a
                        substitute for professional accounting, tax, or legal
                        advice and does not guarantee compliance with government
                        or industry requirements. Business owners remain
                        responsible for reviewing their records and following all
                        applicable rules and regulations.
                    </p>

                    <p className="mt-4 text-xs text-white/40">
                        © {new Date().getFullYear()} StockNBook. All rights reserved.
                    </p>
                </div>
            </footer>

            {selectedPlan && isSubscriptionModalOpen && (
                <SubscriptionModal
                    plan={selectedPlan}
                    onClose={handleCloseSubscriptionModal}
                    onAuthenticate={handlePlanAuthentication}
                />
            )}

            {authMode && (
                <AuthModal
                    mode={authMode}
                    onClose={() => setAuthMode(null)}
                    onSwitch={setAuthMode}
                    onSignupSuccess={() => {
                        setAuthMode(null);
                        onSignupSuccess();
                    }}
                />
            )}
        </main>
    );
}
function PricingSection({
                            pricingPlans,
                            loading,
                            error,
                            onSelectPlan,
                        }: {
    pricingPlans: PricingPlan[];
    loading: boolean;
    error: string;
    onSelectPlan: (plan: PricingPlan) => void;
}) {
    return (
        <section id="pricing" className="scroll-mt-20 bg-[#F4EFF9] px-5 py-20 sm:px-6 lg:px-10">
            <div className="mx-auto max-w-6xl">
                <p className="text-center text-xs font-medium uppercase tracking-[0.2em] text-[#C9951A]">
                    Subscription plans
                </p>

                <h2 className="mt-3 text-center text-3xl font-semibold tracking-[-0.025em] text-[#21172C] sm:text-4xl lg:text-5xl">
                    Choose the plan that fits your business
                </h2>

                <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-7 text-[#706578] sm:text-base">
                    Start with the free plan, then upgrade when your inventory,
                    bookings, staff, and reporting needs grow.
                </p>

                <div className="mx-auto mt-6 flex max-w-2xl items-start gap-3 rounded-xl border border-[#E6D9BA] bg-[#FFFBF0] px-4 py-3">
                    <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#C9951A]" />
                    <p className="text-sm leading-6 text-[#6F6043]">
                        Plan prices, limits, and feature access are managed by the platform administrator.
                    </p>
                </div>

                {loading ? (
                    <div className="mt-12 rounded-2xl border border-[#E7E0ED] bg-white px-6 py-16 text-center text-sm text-[#7A6E88]">
                        Loading current plans...
                    </div>
                ) : error ? (
                    <div className="mt-12 rounded-2xl border border-[#F0B9B9] bg-[#FFF0F0] px-6 py-10 text-center">
                        <p className="text-sm font-medium text-[#C32F2F]">{error}</p>
                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            className="mt-4 rounded-xl bg-[#2D1B4E] px-5 py-2.5 text-sm font-medium text-white"
                        >
                            Try again
                        </button>
                    </div>
                ) : pricingPlans.length === 0 ? (
                    <div className="mt-12 rounded-2xl border border-[#E7E0ED] bg-white px-6 py-16 text-center text-sm text-[#7A6E88]">
                        No plans are currently available.
                    </div>
                ) : (
                    <div className="mt-12 grid items-stretch gap-6 lg:grid-cols-3">
                        {pricingPlans.map((plan) => (
                            <PricingCard
                                key={plan.id}
                                plan={plan}
                                onSelectPlan={onSelectPlan}
                            />
                        ))}
                    </div>
                )}

                <p className="mt-8 text-center text-xs leading-5 text-[#7A6E88]">
                    No automatic recurring charges. Paid subscriptions use manual GCash payment verification.
                </p>
            </div>
        </section>
    );
}

function PricingCard({
                         plan,
                         onSelectPlan,
                     }: {
    plan: PricingPlan;
    onSelectPlan: (plan: PricingPlan) => void;
}) {
    return (
        <article
            className={[
                "relative flex h-full flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-xl",
                plan.highlighted
                    ? "border-[#2D1B4E] ring-2 ring-[#2D1B4E]"
                    : "border-[#EBE4F0]",
            ].join(" ")}
        >
            {plan.highlighted && (
                <div className="bg-[#2D1B4E] px-4 py-2 text-center text-xs font-medium uppercase tracking-[0.16em] text-white">
                    Standard plan
                </div>
            )}

            <div className="flex h-full flex-col p-6">
                <div>
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#C9951A]">
                        {plan.label}
                    </p>

                    <h3 className="mt-3 text-3xl font-semibold text-[#1A1220]">
                        {plan.name}
                    </h3>

                    <div className="mt-5 flex items-end gap-1">
                        <span className="text-4xl font-semibold tracking-tight text-[#1A1220]">
                            {plan.price}
                        </span>

                        <span className="pb-1 text-sm text-[#7A6E88]">
                            {plan.period}
                        </span>
                    </div>

                    <p className="mt-4 min-h-[72px] text-sm leading-6 text-[#7A6E88]">
                        {plan.description}
                    </p>
                </div>

                <div className="mt-7 flex-1 border-t border-[#EBE4F0] pt-6">
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#7A6E88]">
                        Included features
                    </p>

                    <ul className="mt-4 space-y-3">
                        {plan.features.map((feature) => (
                            <li
                                key={feature}
                                className="flex items-start gap-2.5 text-sm leading-5 text-[#3F354C]"
                            >
                                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#FFF7E2]">
                                    <Check className="h-3.5 w-3.5 text-[#C9951A]" />
                                </span>

                                <span>{feature}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                <button
                    type="button"
                    onClick={() => onSelectPlan(plan)}
                    className={[
                        "mt-8 h-12 w-full rounded-xl text-sm font-medium transition duration-200",
                        plan.highlighted
                            ? "bg-[#2D1B4E] text-white hover:bg-[#3D2560]"
                            : "border border-[#2D1B4E] bg-white text-[#2D1B4E] hover:bg-[#2D1B4E] hover:text-white",
                    ].join(" ")}
                >
                    {plan.buttonText}
                </button>
            </div>
        </article>
    );
}

function SubscriptionModal({
                               plan,
                               onClose,
                               onAuthenticate,
                           }: {
    plan: PricingPlan;
    onClose: () => void;
    onAuthenticate: (mode: Exclude<AuthMode, null>) => void;
}) {
    const handleAuthenticate = (mode: Exclude<AuthMode, null>) => {
        onAuthenticate(mode);
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="plan-access-dialog-title"
            className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#160C27]/65 px-4 py-6 backdrop-blur-[3px] sm:px-6"
            onMouseDown={onClose}
        >
            <div className="flex min-h-full w-full items-center justify-center py-6 sm:py-10">
                <div
                    className="relative w-full max-w-[720px] overflow-hidden rounded-[26px] border border-white/80 bg-white shadow-[0_30px_90px_rgba(26,13,48,0.30)]"
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close plan selection dialog"
                        className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-[#F2EEF8] text-[#70647F] transition hover:bg-[#E8E0F2] hover:text-[#2D1B4E]"
                    >
                        <X className="h-5 w-5" />
                    </button>

                    <div className="px-6 pb-5 pt-7 sm:px-8 sm:pb-6 sm:pt-8">
                        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
                            <div className="mx-auto flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_35%_30%,_#F5F0FF_0%,_#EAE1FB_55%,_#F8F5FC_100%)] text-[#5B35A5] shadow-inner sm:mx-0">
                                <div className="flex h-[74px] w-[60px] items-center justify-center rounded-[18px] border border-[#8060D0] bg-[linear-gradient(160deg,_#7B55D0_0%,_#4E2A9C_100%)] shadow-[0_12px_24px_rgba(91,53,165,0.25)]">
                                    <LockKeyhole className="h-9 w-9 text-white" strokeWidth={1.9} />
                                </div>
                            </div>

                            <div className="min-w-0 flex-1 text-center sm:text-left">
                                <div className="inline-flex items-center rounded-full border border-[#E5DCF2] bg-[#F8F5FF] px-3 py-1 text-xs font-semibold text-[#5B35A5]">
                                    {plan.name} plan selected
                                </div>

                                <h2
                                    id="plan-access-dialog-title"
                                    className="mt-3 max-w-[500px] text-2xl font-semibold leading-tight tracking-[-0.025em] text-[#171125] sm:text-[30px]"
                                >
                                    Continue to choose your plan
                                </h2>

                                <p className="mt-2 max-w-[520px] text-sm leading-6 text-[#6F657A] sm:text-[15px]">
                                    Log in or sign up first so we can connect your selected plan to your account and store securely.
                                </p>
                            </div>
                        </div>

                        <div className="mt-6 h-px bg-[#ECE6F2]" />

                        <div className="mt-5 grid gap-4 sm:grid-cols-2">
                            <div className="rounded-2xl border border-[#E8E0F3] bg-[linear-gradient(145deg,_#FBF9FF_0%,_#F4EFFC_100%)] p-5 sm:p-6">
                                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E9E1FA] text-[#5B35A5]">
                                    <UserRound className="h-6 w-6" />
                                </div>

                                <h3 className="mt-4 text-lg font-semibold text-[#171125]">
                                    New to StockNBook?
                                </h3>

                                <p className="mt-1 text-sm leading-6 text-[#6F657A]">
                                    Create your account to get started.
                                </p>

                                <ul className="mt-4 space-y-2.5">
                                    <li className="flex items-start gap-2.5 text-sm text-[#4F465C]">
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#5B35A5]" />
                                        <span>Create your store and account</span>
                                    </li>
                                    <li className="flex items-start gap-2.5 text-sm text-[#4F465C]">
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#5B35A5]" />
                                        <span>Start with the {plan.name} plan</span>
                                    </li>
                                    <li className="flex items-start gap-2.5 text-sm text-[#4F465C]">
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#5B35A5]" />
                                        <span>Manage everything in one place</span>
                                    </li>
                                </ul>

                                <button
                                    type="button"
                                    onClick={() => handleAuthenticate("signup")}
                                    className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#5B35A5] px-5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(91,53,165,0.20)] transition hover:bg-[#4B238F] hover:shadow-[0_10px_24px_rgba(91,53,165,0.25)]"
                                >
                                    Sign up
                                    <ArrowRight className="h-4 w-4" />
                                </button>
                            </div>

                            <div className="rounded-2xl border border-[#E8E0F3] bg-[linear-gradient(145deg,_#FBF9FF_0%,_#F4EFFC_100%)] p-5 sm:p-6">
                                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E9E1FA] text-[#5B35A5]">
                                    <LogIn className="h-6 w-6" />
                                </div>

                                <h3 className="mt-4 text-lg font-semibold text-[#171125]">
                                    Already have an account?
                                </h3>

                                <p className="mt-1 text-sm leading-6 text-[#6F657A]">
                                    Log in to continue with your selected plan.
                                </p>

                                <ul className="mt-4 space-y-2.5">
                                    <li className="flex items-start gap-2.5 text-sm text-[#4F465C]">
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#5B35A5]" />
                                        <span>Use your existing account</span>
                                    </li>
                                    <li className="flex items-start gap-2.5 text-sm text-[#4F465C]">
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#5B35A5]" />
                                        <span>Keep your data and settings</span>
                                    </li>
                                    <li className="flex items-start gap-2.5 text-sm text-[#4F465C]">
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#5B35A5]" />
                                        <span>Continue where you left off</span>
                                    </li>
                                </ul>

                                <button
                                    type="button"
                                    onClick={() => handleAuthenticate("login")}
                                    className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#6D49B5] bg-white px-5 text-sm font-semibold text-[#5B35A5] transition hover:bg-[#F7F2FD]"
                                >
                                    Log in
                                    <ArrowRight className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        <div className="mt-5 flex items-start justify-center gap-3 rounded-xl border border-[#E8E1F0] bg-[#FBFAFD] px-4 py-3.5 text-center sm:text-left">
                            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#5B35A5]" />
                            <div>
                                <p className="text-sm font-medium text-[#41374E]">
                                    Your information is safe with us.
                                </p>
                                <p className="mt-0.5 text-xs leading-5 text-[#7A7084]">
                                    We use your account to securely connect your plan and subscription activity to your store.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function HeroFeatureBubble({
                               title,
                               detail,
                               icon,
                               className = "",
                               animationDelay = "0s",
                           }: {
    title: string;
    detail: string;
    icon: React.ReactNode;
    className?: string;
    animationDelay?: string;
}) {
    return (
        <div
            className={[
                "absolute z-20 hidden md:block",
                className,
            ].join(" ")}
        >
            <div
                className="hero-feature-float flex w-[168px] items-center gap-2.5 rounded-[18px] border border-[#F2E9D7] bg-[#FFFDF8] px-3 py-2.5 text-left shadow-[0_14px_38px_rgba(17,7,32,0.26)] transition-shadow duration-300 hover:shadow-[0_22px_52px_rgba(17,7,32,0.34)]"
                style={{ animationDelay }}
            >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFF0C5] text-[#C9951A]">
                    {icon}
                </span>

                <div className="min-w-0">
                    <p className="text-xs font-semibold leading-4 text-[#21172C]">
                        {title}
                    </p>

                    <p className="mt-0.5 text-[10px] leading-[14px] text-[#716778]">
                        {detail}
                    </p>
                </div>
            </div>
        </div>
    );
}

function SectionHeading({
                            eyebrow,
                            title,
                            description,
                        }: {
    eyebrow: string;
    title: string;
    description: string;
}) {
    return (
        <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#C9951A]">
                {eyebrow}
            </p>

            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.025em] text-[#21172C] sm:text-4xl lg:text-5xl">
                {title}
            </h2>

            <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#706578] sm:text-base">
                {description}
            </p>
        </div>
    );
}

function ProofStat({
                       value,
                       label,
                       detail,
                       icon,
                   }: {
    value: string;
    label: string;
    detail: string;
    icon: React.ReactNode;
}) {
    return (
        <article className="group relative rounded-3xl border border-[#E7DCEB] bg-white px-5 pb-6 pt-5 text-center shadow-[0_16px_40px_rgba(45,27,78,0.08)] transition duration-300 hover:-translate-y-2 hover:border-[#D6C4DE] hover:shadow-[0_24px_55px_rgba(45,27,78,0.14)]">
            <div className="absolute left-1/2 top-0 h-1.5 w-14 -translate-x-1/2 rounded-b-full bg-[#D4A126]" />

            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F1ECF8] text-[#2D1B4E] ring-8 ring-[#FFF8EA] transition group-hover:bg-[#2D1B4E] group-hover:text-white">
                {icon}
            </div>

            <p className="mt-5 text-3xl font-bold tracking-[-0.05em] text-[#2D1B4E] sm:text-4xl">
                {value}
            </p>

            <h3 className="mt-2 text-base font-bold tracking-[-0.02em] text-[#21172C]">
                {label}
            </h3>

            <p className="mt-1 text-sm text-[#81758A]">{detail}</p>

            <div className="mx-auto mt-5 h-px w-12 bg-[#E4D9E9] transition-all duration-300 group-hover:w-20 group-hover:bg-[#D4A126]" />
        </article>
    );
}

function FeatureCard({
                         number,
                         title,
                         desc,
                         className = "",
                     }: {
    number: string;
    title: string;
    desc: string;
    className?: string;
}) {
    return (
        <article
            className={[
                "group flex min-h-[250px] flex-col rounded-2xl border border-[#E7E0ED] bg-white p-6 shadow-[0_10px_30px_rgba(45,27,78,0.04)] transition duration-300 hover:-translate-y-1 hover:border-[#D7C9E3] hover:shadow-[0_20px_45px_rgba(45,27,78,0.10)]",
                className,
            ].join(" ")}
        >
            <div className="flex items-center justify-between gap-4">
                <span className="inline-flex h-10 min-w-10 items-center justify-center rounded-xl bg-[#F1ECF8] px-3 text-sm font-medium text-[#2D1B4E]">
                    {number}
                </span>

                <div className="h-px flex-1 bg-[#EDE6F2]" />
            </div>

            <h3 className="mt-6 text-lg font-bold tracking-[-0.02em] text-[#21172C]">
                {title}
            </h3>

            <p className="mt-3 text-sm leading-7 text-[#706578]">{desc}</p>
        </article>
    );
}

function FaqItem({
                     number,
                     question,
                     answer,
                 }: {
    number: string;
    question: string;
    answer: string;
}) {
    return (
        <article className="group rounded-2xl border border-[#E7E0ED] bg-white p-6 shadow-[0_10px_30px_rgba(45,27,78,0.04)] transition duration-300 hover:-translate-y-1 hover:border-[#D8CBE3] hover:shadow-[0_18px_40px_rgba(45,27,78,0.08)]">
            <div className="flex items-start gap-4">
                <span className="flex h-9 min-w-9 items-center justify-center rounded-xl bg-[#F1ECF8] px-2 text-xs font-medium text-[#2D1B4E]">
                    {number}
                </span>

                <div>
                    <h3 className="text-base font-bold leading-6 text-[#21172C] sm:text-lg">
                        {question}
                    </h3>

                    <p className="mt-2 text-sm leading-7 text-[#706578]">
                        {answer}
                    </p>
                </div>
            </div>
        </article>
    );
}

function HowItWorksCard({
                            id,
                            icon,
                            title,
                            steps,
                        }: {
    id: string;
    icon: React.ReactNode;
    title: string;
    steps: string[];
}) {
    return (
        <article
            id={id}
            className="scroll-mt-28 rounded-2xl border border-[#E7E0ED] bg-[#FCFAFD] p-5 shadow-[0_12px_35px_rgba(45,27,78,0.05)] transition hover:border-[#D8CBE3] hover:shadow-[0_18px_45px_rgba(45,27,78,0.08)] sm:p-8"
        >
            <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#F1ECF8] text-[#2D1B4E]">
                    {icon}
                </div>

                <h3 className="text-xl font-bold tracking-[-0.02em] text-[#21172C] sm:text-2xl">
                    {title}
                </h3>
            </div>

            <ol className="mt-6 space-y-4">
                {steps.map((step, index) => (
                    <li
                        key={step}
                        className="flex items-start gap-3 text-sm leading-6 text-[#706578] sm:gap-4 sm:text-base"
                    >
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EEE8F8] text-xs font-bold text-[#2D1B4E]">
                            {index + 1}
                        </span>

                        <span>{step}</span>
                    </li>
                ))}
            </ol>
        </article>
    );
}