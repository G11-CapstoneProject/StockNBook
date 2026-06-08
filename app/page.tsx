"use client";

import { useState } from "react";
import LandingPage from "@/components/landing/LandingPage";
import SetupScreen from "@/components/landing/SetupScreen";

export default function Home() {
  const [showSetup, setShowSetup] = useState(false);

  if (showSetup) {
    return <SetupScreen />;
  }

  return <LandingPage onSignupSuccess={() => setShowSetup(true)} />;
}

