"use client";
// KI-20: one bad card must never unmount the whole dashboard. Wraps the place
// panel; Dashboard passes key={selected} so picking another place resets it.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Card } from "./ui";

export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("place panel failed to render", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <Card title="place">
          <div className="text-[12px] text-ink-2">This place&apos;s details could not be drawn.</div>
        </Card>
      );
    }
    return this.props.children;
  }
}
