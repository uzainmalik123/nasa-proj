"use client";
import dynamic from "next/dynamic";

// The whole app is client-rendered (MapLibre needs window); static export
// still emits the shell. S4 may swap this for its own Dashboard import.
const Dashboard = dynamic(() => import("@/components/Dashboard"), { ssr: false });

export default function Home() {
  return <Dashboard />;
}
