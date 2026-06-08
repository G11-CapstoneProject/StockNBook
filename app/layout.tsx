import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import RoleSidebar from "@/components/sidebar/RoleSidebar";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"]
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "StockNBook",
    description: "SaaS management system for event-related businesses",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
                {/* Layout Flex: Sidebar + Page Content */}
                <div className="flex min-h-screen">
                    <RoleSidebar />
                    <main className="flex-1">{children}</main>
                </div>
            </body>
        </html>
    );
}