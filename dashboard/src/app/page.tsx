"use client";
import dynamic from "next/dynamic";
import { LoadingShell } from "@/components/Shell";

// The whole app is client-rendered (MapLibre needs window); static export
// prerenders the loading shell, so the first paint is the frame, not black.
const Dashboard = dynamic(() => import("@/components/Dashboard"), { ssr: false, loading: LoadingShell });

export default function Home() {
  return <Dashboard />;
}
