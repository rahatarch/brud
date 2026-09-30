"use client";

import useLowPower from "@/hooks/useLowPower";

// Renders nothing; only tags <html> so weak machines get the cheaper chrome.
export default function HeroPower() {
  useLowPower();
  return null;
}
