"use client";

import { type ReactNode, useEffect, useId, useState } from "react";
import pkg from "../../package.json";
import type { BrandConfig } from "../brand";
import type { RequestScope } from "../server/request-context";
import { Avatar, AvatarFallback } from "./generated/avatar";
import { Button } from "./generated/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "./generated/dropdown-menu";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverTitle,
	PopoverTrigger,
} from "./generated/popover";
import { TooltipProvider } from "./generated/tooltip";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarSeparator,
	SidebarTrigger,
	useSidebar,
} from "./generated/sidebar";

export interface ShellProps {
	children: ReactNode;
	scope: RequestScope | null;
	pathname: string;
	returnTo?: string;
	brand?: BrandConfig;
}

type Theme = "system" | "light" | "dark";
type Density = "comfortable" | "compact";
type SidebarPreference = "expanded" | "collapsed";
type Prefs = { theme: Theme; density: Density; sidebar: SidebarPreference };
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

/** safe-ls: cosmetic theme, density and navigation preferences never reach an API request. */
function applyPrefs(prefs: Prefs) {
	const root = document.documentElement;
	if (prefs.theme === "system") root.removeAttribute("data-theme");
	else root.dataset.theme = prefs.theme;
	root.dataset.density = prefs.density;
	root.dataset.sidebar = prefs.sidebar;
}
function savePrefs(prefs: Prefs) {
	try {
		// safe-ls: cosmetic preferences only, with a graceful default when storage is unavailable.
		localStorage.setItem("prefs", JSON.stringify(prefs));
		localStorage.removeItem("theme");
	} catch {
		/* Cosmetic preference storage is optional. */
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
	const info = glossary[term];
	return (
		<Popover>
			<PopoverTrigger render={<SidebarMenuAction aria-label={`About ${info.label}`} />}>
				<span aria-hidden="true">ⓘ</span>
			</PopoverTrigger>
			<PopoverContent side="right" align="start" sideOffset={8} className="w-64">
				<PopoverTitle>{info.label}</PopoverTitle>
				<PopoverDescription>{info.definition}</PopoverDescription>
			</PopoverContent>
		</Popover>
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

function Preferences({ prefs, update }: { prefs: Prefs; update: (patch: Partial<Prefs>) => void }) {
	const { open, setOpen } = useSidebar();
	return (
		<>
			<DropdownMenuSeparator />
			<DropdownMenuGroup>
				<DropdownMenuLabel>Density</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={prefs.density}
					onValueChange={(value) =>
						update({ density: value === "compact" ? "compact" : "comfortable" })
					}
				>
					<DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuGroup>
			<DropdownMenuSeparator />
			<DropdownMenuGroup>
				<DropdownMenuLabel>Sidebar</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={open ? "expanded" : "collapsed"}
					onValueChange={(value) => setOpen(value !== "collapsed")}
				>
					<DropdownMenuRadioItem value="expanded">Expanded</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="collapsed">Collapsed</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuGroup>
		</>
	);
}

function AccountMenu({
	scope,
	returnTo,
	prefs,
	update,
}: {
	scope: RequestScope | null;
	returnTo: string;
	prefs: Prefs;
	update: (patch: Partial<Prefs>) => void;
}) {
	const refreshId = useId();
	const logoutId = useId();
	const user = scope?.user;
	if (!user)
		return (
			<form method="post" action="/auth/session">
				<input type="hidden" name="action" value="login" />
				<input type="hidden" name="redirect_url" value={returnTo} />
				<Button type="submit" variant="ghost">
					Log in
				</Button>
			</form>
		);
	return (
		<>
			{/* Keep native auth forms outside the portalled menu so closing it cannot discard the form. */}
			<form hidden id={refreshId} method="post" action="/auth/session">
				<input type="hidden" name="action" value="login" />
				<input type="hidden" name="redirect_url" value={returnTo} />
			</form>
			<form hidden id={logoutId} method="post" action="/auth/session">
				<input type="hidden" name="action" value="logout" />
			</form>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							aria-label={`Account: ${user.name || user.email}`}
							className="max-w-full gap-2"
						/>
					}
				>
					<Avatar className="size-7">
						<AvatarFallback>{initials(user.name, user.email)}</AvatarFallback>
					</Avatar>
					<span className="hidden max-w-48 truncate sm:inline">{user.name || user.email}</span>
					<span aria-hidden="true">▾</span>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" sideOffset={8} className="w-60">
					<DropdownMenuGroup>
						<DropdownMenuLabel>
							<span className="block truncate font-semibold">{user.name}</span>
							<span className="block truncate font-normal">{user.email}</span>
						</DropdownMenuLabel>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuItem nativeButton render={<button type="submit" form={refreshId} />}>
						Refresh session
					</DropdownMenuItem>
					<DropdownMenuItem nativeButton render={<button type="submit" form={logoutId} />}>
						Log out
					</DropdownMenuItem>
					<Preferences prefs={prefs} update={update} />
				</DropdownMenuContent>
			</DropdownMenu>
		</>
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

function workspaceHref(path: string, scope: RequestScope | null) {
	const selection = scope?.selection;
	if (selection?.kind !== "workspace" && selection?.kind !== "project") return path;
	return `${path}?${new URLSearchParams({ workspace: selection.workspace.slug })}`;
}

function ShellContent({
	children,
	scope,
	pathname,
	returnTo,
	brand,
	prefs,
	update,
}: ShellProps & { prefs: Prefs; update: (patch: Partial<Prefs>) => void }) {
	const { setOpenMobile } = useSidebar();
	const brandName = brand?.name ?? "Projektor";
	const brandMark = brand?.mark ?? "P";
	const projectsHref = workspaceHref("/", scope);
	const fullBleed = pathname === "/wiki" || pathname.startsWith("/wiki/");
	function cycleTheme() {
		const order: Theme[] = ["system", "light", "dark"];
		update({ theme: order[(order.indexOf(prefs.theme) + 1) % order.length] });
	}
	return (
		<>
			<header className="projektor-topbar">
				<div className="flex min-w-0 items-center gap-2">
					<SidebarTrigger className="md:hidden" />
					<a href={projectsHref} className="topbar-brand min-w-0">
						<span className="brand-mark">{brandMark}</span>
						<span className="truncate">{brandName}</span>
					</a>
				</div>
				<AccountMenu scope={scope} returnTo={returnTo ?? "/"} prefs={prefs} update={update} />
			</header>
			<Sidebar collapsible="icon" className="pt-[var(--topbar-height)]">
				<SidebarHeader className="md:hidden">
					<a href={projectsHref} className="topbar-brand" onClick={() => setOpenMobile(false)}>
						<span className="brand-mark">{brandMark}</span>
						<span>{brandName}</span>
					</a>
				</SidebarHeader>
				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupContent>
							<SidebarMenu aria-label="Primary navigation">
								{nav.map((item) => {
									const active =
										item.href === "/"
											? pathname === "/"
											: pathname === item.href || pathname.startsWith(`${item.href}/`);
									return (
										<SidebarMenuItem key={item.href}>
											<SidebarMenuButton
												isActive={active}
												tooltip={item.label}
												render={
													<a
														href={workspaceHref(item.href, scope)}
														aria-current={active ? "page" : undefined}
														onClick={() => setOpenMobile(false)}
													/>
												}
											>
												<Icon>{item.icon}</Icon>
												<span>{item.label}</span>
											</SidebarMenuButton>
											{"glossary" in item && <GlossaryHelp term={item.glossary} />}
										</SidebarMenuItem>
									);
								})}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
				<SidebarSeparator />
				<SidebarFooter>
					<div className="flex flex-wrap gap-1 group-data-[collapsible=icon]:flex-col">
						<Button
							variant="ghost"
							size="icon-sm"
							render={<a href="/help" />}
							nativeButton={false}
							aria-label="Help, glossary of terms"
							title="Help"
						>
							<Icon>
								<circle cx="12" cy="12" r="10" />
								<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
							</Icon>
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`Theme: ${prefs.theme}, switch theme`}
							onClick={cycleTheme}
						>
							<ThemeIcon theme={prefs.theme} />
						</Button>
						<SidebarTrigger />
					</div>
					<span className="px-2 text-[0.6875rem] text-muted-foreground group-data-[collapsible=icon]:hidden">
						v{pkg.version}
					</span>
				</SidebarFooter>
			</Sidebar>
			<SidebarInset id="main-content" tabIndex={-1} className="min-w-0 pt-[var(--topbar-height)]">
				<div className="projektor-page-content" data-full-bleed={fullBleed || undefined}>
					{children}
				</div>
			</SidebarInset>
		</>
	);
}

/** Request-local scope stays in props. Generated Base UI owns drawer, menu positioning and sidebar controls. */
export function Shell(props: ShellProps) {
	const [prefs, setPrefs] = useState(DEFAULT_PREFS);
	useEffect(() => {
		const next = readPrefs();
		setPrefs(next);
		applyPrefs(next);
	}, []);
	function update(patch: Partial<Prefs>) {
		const next = { ...readPrefs(), ...patch };
		savePrefs(next);
		applyPrefs(next);
		setPrefs(next);
	}
	return (
		<>
			<a className="skip-link" href="#main-content">
				Skip to content
			</a>
			<OfflineBanner />
			<TooltipProvider>
				<SidebarProvider
					open={prefs.sidebar === "expanded"}
					onOpenChange={(open) => update({ sidebar: open ? "expanded" : "collapsed" })}
				>
					<ShellContent {...props} prefs={prefs} update={update} />
				</SidebarProvider>
			</TooltipProvider>
		</>
	);
}
