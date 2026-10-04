"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { BrandConfig } from "../brand";
import type { RequestScope } from "../server/request-context";

export interface ShellProps {
	children: ReactNode;
	scope: RequestScope | null;
	pathname: string;
	returnTo?: string;
	brand?: BrandConfig;
}

type Theme = "system" | "light" | "dark";
type Density = "comfortable" | "compact";
type Sidebar = "expanded" | "collapsed";
type Prefs = { theme: Theme; density: Density; sidebar: Sidebar };

const DEFAULT_PREFS: Prefs = { theme: "system", density: "comfortable", sidebar: "expanded" };
const glossary = {
	groups: {
		label: "Groups",
		definition: "Teams of members that share the same project access permissions.",
	},
	tokens: {
		label: "Tokens",
		definition: "API keys that let external tools or AI agents act on your behalf.",
	},
} as const;

function readPrefs(): Prefs {
	try {
		const value = JSON.parse(localStorage.getItem("prefs") ?? "null");
		const legacyTheme = localStorage.getItem("theme");
		return {
			theme:
				value?.theme === "light" || value?.theme === "dark" || value?.theme === "system"
					? value.theme
					: legacyTheme === "light" || legacyTheme === "dark"
						? legacyTheme
						: "system",
			density: value?.density === "compact" ? "compact" : "comfortable",
			sidebar: value?.sidebar === "collapsed" ? "collapsed" : "expanded",
		};
	} catch {
		return DEFAULT_PREFS;
	}
}

/** safe-ls: preferences only control the theme, density, and navigation width and never reach an API request. */
function applyPrefs(prefs: Prefs) {
	const root = document.documentElement;
	if (prefs.theme === "system") root.removeAttribute("data-theme");
	else root.dataset.theme = prefs.theme;
	root.dataset.density = prefs.density;
	root.dataset.sidebar = prefs.sidebar;
}
function savePrefs(prefs: Prefs) {
	try {
		localStorage.setItem("prefs", JSON.stringify(prefs));
		localStorage.removeItem("theme");
	} catch {
		/* cosmetic preference storage is optional */
	}
}
function Icon({ children }: { children: ReactNode }) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}
function initials(name: string, email: string) {
	const words = (name.trim() || email).split(/\s+/).filter(Boolean);
	return words.length > 1
		? `${words[0][0]}${words[1][0]}`.toUpperCase()
		: (words[0] ?? "?").slice(0, 2).toUpperCase();
}

function ThemeIcon({ theme }: { theme: Theme }) {
	return (
		<Icon>
			{theme === "light" ? (
				<>
					<circle cx="12" cy="12" r="5" />
					<path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
				</>
			) : theme === "dark" ? (
				<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
			) : (
				<>
					<rect x="2" y="3" width="20" height="14" rx="2" />
					<path d="M8 21h8M12 17v4" />
				</>
			)}
		</Icon>
	);
}

function GlossaryHelp({ term }: { term: keyof typeof glossary }) {
	const [open, setOpen] = useState(false);
	const id = useId();
	const info = glossary[term];
	return (
		<span className="metric-help">
			<button
				type="button"
				className="metric-help-trigger"
				aria-label={`About ${info.label}`}
				aria-expanded={open}
				aria-describedby={open ? id : undefined}
				onClick={() => setOpen(!open)}
			>
				<span aria-hidden="true">ⓘ</span>
			</button>
			{open && (
				<span
					id={id}
					role="dialog"
					aria-label={`${info.label} definition`}
					className="popover popover-metric-help"
				>
					<p className="m-0 text-[0.8rem] text-text-base">{info.definition}</p>
				</span>
			)}
		</span>
	);
}

function OfflineBanner() {
	const [online, setOnline] = useState(true);
	useEffect(() => {
		const update = () => setOnline(navigator.onLine);
		update();
		addEventListener("online", update);
		addEventListener("offline", update);
		return () => {
			removeEventListener("online", update);
			removeEventListener("offline", update);
		};
	}, []);
	return online ? null : (
		<div role="status" className="offline-banner">
			You're offline. Changes won't save until your connection returns.
		</div>
	);
}

function AccountMenu({ scope, returnTo }: { scope: RequestScope | null; returnTo: string }) {
	const [open, setOpen] = useState(false);
	const menuId = useId();
	const trigger = useRef<HTMLButtonElement>(null);
	const user = scope?.user;
	useEffect(() => {
		if (!open) return;
		const close = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpen(false);
				trigger.current?.focus();
			}
		};
		document.addEventListener("keydown", close);
		return () => document.removeEventListener("keydown", close);
	}, [open]);
	if (!user)
		return (
			<form method="post" action="/auth/session">
				<input type="hidden" name="action" value="login" />
				<input type="hidden" name="redirect_url" value={returnTo} />
				<button
					type="submit"
					className="account-menu-login border-0 bg-transparent cursor-pointer font-inherit"
				>
					Log in
				</button>
			</form>
		);
	return (
		<div className="account-menu">
			<button
				ref={trigger}
				type="button"
				className="account-menu-trigger"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				aria-label={`Account: ${user.name || user.email}`}
				onClick={() => setOpen(!open)}
			>
				<span className="account-menu-avatar" aria-hidden="true">
					{initials(user.name, user.email)}
				</span>
				<span className="account-menu-name">{user.name || user.email}</span>
				<span className="account-menu-caret" aria-hidden="true">
					▾
				</span>
			</button>
			{open && (
				<div
					id={menuId}
					className="popover popover-account-menu account-menu-popover"
					role="menu"
					aria-label="Account"
				>
					<div className="account-menu-identity">
						<div className="account-menu-identity-name">{user.name}</div>
						<div className="account-menu-identity-email">{user.email}</div>
					</div>
					<form method="post" action="/auth/session">
						<input type="hidden" name="action" value="login" />
						<input type="hidden" name="redirect_url" value={returnTo} />
						<button
							type="submit"
							role="menuitem"
							className="account-menu-item w-full border-0 bg-transparent cursor-pointer text-left font-inherit"
						>
							Refresh session
						</button>
					</form>
					<form method="post" action="/auth/session">
						<input type="hidden" name="action" value="logout" />
						<button
							type="submit"
							role="menuitem"
							className="account-menu-item w-full border-0 bg-transparent cursor-pointer text-left font-inherit"
						>
							Log out
						</button>
					</form>
					<Preferences />
				</div>
			)}
		</div>
	);
}

function Preferences() {
	const [prefs, setPrefs] = useState(DEFAULT_PREFS);
	useEffect(() => {
		setPrefs(readPrefs());
	}, []);
	function update(patch: Partial<Prefs>) {
		const next = { ...readPrefs(), ...patch };
		savePrefs(next);
		applyPrefs(next);
		setPrefs(next);
	}
	return (
		<div className="preferences-section">
			<div className="preferences-row">
				<span>Density</span>
				<fieldset className="preferences-toggle-group">
					<legend className="sr-only">Density</legend>
					<button
						type="button"
						className="preferences-toggle-btn"
						aria-pressed={prefs.density === "comfortable"}
						onClick={() => update({ density: "comfortable" })}
					>
						Comfortable
					</button>
					<button
						type="button"
						className="preferences-toggle-btn"
						aria-pressed={prefs.density === "compact"}
						onClick={() => update({ density: "compact" })}
					>
						Compact
					</button>
				</fieldset>
			</div>
			<div className="preferences-row">
				<span>Sidebar</span>
				<fieldset className="preferences-toggle-group">
					<legend className="sr-only">Sidebar</legend>
					<button
						type="button"
						className="preferences-toggle-btn"
						aria-pressed={prefs.sidebar === "expanded"}
						onClick={() => update({ sidebar: "expanded" })}
					>
						Expanded
					</button>
					<button
						type="button"
						className="preferences-toggle-btn"
						aria-pressed={prefs.sidebar === "collapsed"}
						onClick={() => update({ sidebar: "collapsed" })}
					>
						Collapsed
					</button>
				</fieldset>
			</div>
		</div>
	);
}

const nav = [
	{
		href: "/",
		label: "Projects",
		icon: (
			<>
				<rect x="3" y="3" width="7" height="7" />
				<rect x="14" y="3" width="7" height="7" />
				<rect x="14" y="14" width="7" height="7" />
				<rect x="3" y="14" width="7" height="7" />
			</>
		),
	},
	{
		href: "/my-issues",
		label: "My Issues",
		icon: (
			<>
				<circle cx="12" cy="8" r="4" />
				<path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
			</>
		),
	},
	{
		href: "/settings/groups",
		label: "Groups",
		glossary: "groups",
		icon: (
			<>
				<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
				<circle cx="9" cy="7" r="4" />
				<path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
			</>
		),
	},
	{
		href: "/settings/tokens",
		label: "Connect Agent",
		glossary: "tokens",
		icon: (
			<>
				<rect x="3" y="11" width="18" height="11" rx="2" />
				<path d="M7 11V7a5 5 0 0 1 10 0v4" />
			</>
		),
	},
] as const;

/** Shared SSR shell. Its RequestScope comes from the root loader and contains no client-side identity store. */
export function Shell({ children, scope, pathname, returnTo = "/", brand }: ShellProps) {
	const brandName = brand?.name ?? "Projektor";
	const brandMark = brand?.mark ?? "P";
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [prefs, setPrefs] = useState(DEFAULT_PREFS);
	useEffect(() => {
		const next = readPrefs();
		setPrefs(next);
		applyPrefs(next);
	}, []);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setDrawerOpen(false);
		};
		const media = matchMedia("(min-width: 641px)");
		const close = () => setDrawerOpen(false);
		document.addEventListener("keydown", onKey);
		media.addEventListener("change", close);
		return () => {
			document.removeEventListener("keydown", onKey);
			media.removeEventListener("change", close);
		};
	}, []);
	function cycleTheme() {
		const order: Theme[] = ["system", "light", "dark"];
		const next = order[(order.indexOf(prefs.theme) + 1) % order.length];
		const updated = { ...prefs, theme: next };
		setPrefs(updated);
		savePrefs(updated);
		applyPrefs(updated);
	}
	function toggleSidebar() {
		const updated: Prefs = {
			...prefs,
			sidebar: prefs.sidebar === "collapsed" ? "expanded" : "collapsed",
		};
		setPrefs(updated);
		savePrefs(updated);
		applyPrefs(updated);
	}
	return (
		<>
			<a className="skip-link" href="#main-content">
				Skip to content
			</a>
			<OfflineBanner />
			<div className={`app-shell${drawerOpen ? " drawer-open" : ""}`}>
				<header className="app-topbar" id="app-topbar">
					<div className="app-topbar-start">
						<button
							className="hamburger"
							type="button"
							aria-label={drawerOpen ? "Close navigation menu" : "Open navigation menu"}
							aria-controls="app-sidebar"
							aria-expanded={drawerOpen}
							onClick={() => setDrawerOpen(!drawerOpen)}
						>
							<Icon>
								<path d="M3 6h18M3 12h18M3 18h18" />
							</Icon>
						</button>
						<a href="/" className="topbar-brand">
							<span className="brand-mark">{brandMark}</span>
							<span className="brand-name">{brandName}</span>
						</a>
					</div>
					<AccountMenu scope={scope} returnTo={returnTo} />
				</header>
				<button
					className="drawer-overlay"
					type="button"
					aria-label="Close navigation menu"
					tabIndex={drawerOpen ? 0 : -1}
					onClick={() => setDrawerOpen(false)}
				/>
				<aside className="sidebar" id="app-sidebar">
					<nav className="sidebar-nav" aria-label="Primary">
						{nav.map((item) => {
							const active =
								item.href === "/"
									? pathname === "/"
									: pathname === item.href || pathname.startsWith(`${item.href}/`);
							return (
								<span className="sidebar-link-row" key={item.href}>
									<a
										href={item.href}
										className={`sidebar-link${active ? " active" : ""}`}
										aria-current={active ? "page" : undefined}
										aria-label={item.label}
										onClick={() => setDrawerOpen(false)}
									>
										<Icon>{item.icon}</Icon>
										<span className="link-label">{item.label}</span>
									</a>
									{"glossary" in item && item.glossary && <GlossaryHelp term={item.glossary} />}
								</span>
							);
						})}
					</nav>
					<div className="sidebar-spacer" />
					<div className="sidebar-footer">
						<a
							href="/help"
							className="theme-toggle"
							aria-label="Help, glossary of terms"
							title="Help"
						>
							<Icon>
								<circle cx="12" cy="12" r="10" />
								<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
							</Icon>
						</a>
						<button
							className="theme-toggle"
							type="button"
							aria-label={`Theme: ${prefs.theme}, switch theme`}
							onClick={cycleTheme}
						>
							<ThemeIcon theme={prefs.theme} />
						</button>
						<button
							className="theme-toggle sidebar-collapse-toggle"
							type="button"
							aria-label={prefs.sidebar === "collapsed" ? "Expand sidebar" : "Collapse sidebar"}
							aria-expanded={prefs.sidebar !== "collapsed"}
							aria-controls="app-sidebar"
							onClick={toggleSidebar}
						>
							<Icon>
								<rect x="3" y="4" width="18" height="16" rx="2" />
								<path d="M10 4v16" />
							</Icon>
						</button>
					</div>
					<div className="sidebar-version">{brandName}</div>
				</aside>
				<main className="app-main" id="main-content" tabIndex={-1}>
					{children}
				</main>
			</div>
		</>
	);
}
