"use client";
import { useEffect, useState } from "react";
/** Null preserves both CSS-controlled layouts in SSR and the hydration snapshot. */
export function useMediaQuery(query: string): boolean | null {
	const [matches, setMatches] = useState<boolean | null>(null);
	useEffect(() => {
		if (typeof window.matchMedia !== "function") {
			setMatches(false);
			return;
		}
		const mql = window.matchMedia(query);
		const onChange = () => setMatches(mql.matches);
		onChange();
		mql.addEventListener?.("change", onChange);
		return () => mql.removeEventListener?.("change", onChange);
	}, [query]);
	return matches;
}
