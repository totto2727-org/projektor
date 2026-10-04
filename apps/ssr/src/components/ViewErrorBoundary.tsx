"use client";

import { Component, type ReactNode } from "react";

/** Expected operation failures stay in action results. This catches unexpected client/render faults only. */
export class ViewErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	render() {
		if (!this.state.failed) return this.props.children;
		return (
			<div role="alert" className="page-container">
				<h2>This view could not be completed.</h2>
				<p>
					An action may already have completed. Reload to check the latest state before submitting
					it again.
				</p>
				<button
					type="button"
					className="btn btn-secondary"
					onClick={() => window.location.reload()}
				>
					Reload page
				</button>
			</div>
		);
	}
}
