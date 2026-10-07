"use client";

import { useForm } from "@tanstack/react-form";
import { Schema } from "effect";
import { type KeyboardEvent, useActionState, useEffect, useRef, useState } from "react";
import { unwrapResult } from "../../client/functions";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Input, Textarea } from "../../components/ui/Input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeaderCell,
	TableRow,
} from "../../components/ui/Table";
import { FormErrors } from "../planning/form-ui";
import {
	addGroupMember,
	createGroup,
	createGroupGrant,
	deleteGroup,
	describeGroup,
	removeGroupGrant,
	removeGroupMember,
	renameGroup,
	setGroupGrant,
} from "./actions";
import {
	CreateGroupInputSchema,
	GroupDescriptionInputSchema,
	GroupGrantInputSchema,
	GroupMemberInputSchema,
	type GroupView,
	RenameGroupInputSchema,
} from "./input-schemas";
import type {
	GrantRole,
	GroupData,
	GroupDetail,
	GroupGrant,
	GroupSummary,
	MemberGroupsRow,
	ProjectLite,
	WorkspaceMember,
} from "./types";

const ROLES: GrantRole[] = ["viewer", "member", "admin"];
const INPUT =
	"px-[0.625rem] py-[0.4rem] border border-border rounded text-[0.85rem] bg-bg text-text-base font-[inherit] focus:outline-[2px] focus:outline-accent focus:outline-offset-1";
const CARD = "border border-border rounded-lg bg-surface p-4 mb-4";
const INFO =
	"flex items-center gap-2 border border-border rounded-lg bg-bg px-4 py-3 mb-4 text-[0.82rem] text-text-base";
const ROLE_TAG =
	"inline-flex items-center px-2 py-[0.1rem] rounded-full text-[0.72rem] font-semibold bg-accent text-white uppercase tracking-wide";
const CHIP =
	"inline-flex items-center px-2 py-[0.1rem] mr-1 mb-1 rounded-full text-[0.72rem] bg-bg border border-border text-text-base";
const H2 = "text-[1.05rem] font-bold text-text-base m-0 mb-3";
const adminRole = (role: string) => role === "owner" || role === "admin";
type Tab = "groups" | "members";
export function nextTabId(tabs: readonly Tab[], active: Tab, key: string): Tab | null {
	const index = tabs.indexOf(active);
	if (key === "ArrowRight") return tabs[(index + 1) % tabs.length];
	if (key === "ArrowLeft") return tabs[(index - 1 + tabs.length) % tabs.length];
	if (key === "Home") return tabs[0];
	if (key === "End") return tabs[tabs.length - 1];
	return null;
}
function MemberGroupsCell({
	member,
	groups,
}: {
	member: WorkspaceMember;
	groups: { id: string; name: string }[];
}) {
	if (adminRole(member.role))
		return <span className="text-[0.78rem] text-text-muted">All projects (bypasses groups)</span>;
	if (groups.length === 0) return <Badge>Pending: no access</Badge>;
	return (
		<>
			{groups.map((group) => (
				<span key={group.id} className={CHIP}>
					{group.name}
				</span>
			))}
		</>
	);
}
function MembersOverview({
	members,
	memberGroups,
}: {
	members: WorkspaceMember[];
	memberGroups: MemberGroupsRow[];
}) {
	const byUser = new Map(memberGroups.map((row) => [row.userId, row.groups]));
	return (
		<section className={CARD}>
			<h2 className={H2}>Members</h2>
			<div className="overflow-x-auto max-sm:hidden">
				<Table className="text-[0.85rem]">
					<TableHead>
						<TableRow>
							<TableHeaderCell>Member</TableHeaderCell>
							<TableHeaderCell>Workspace role</TableHeaderCell>
							<TableHeaderCell>Groups</TableHeaderCell>
						</TableRow>
					</TableHead>
					<TableBody>
						{members.map((member) => (
							<TableRow key={member.id}>
								<TableCell>
									<div className="font-medium text-text-base">{member.name || member.email}</div>
									<div className="text-[0.75rem] text-text-muted">{member.email}</div>
								</TableCell>
								<TableCell>{member.role}</TableCell>
								<TableCell>
									<MemberGroupsCell member={member} groups={byUser.get(member.id) ?? []} />
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			<div className="hidden max-sm:flex max-sm:flex-col max-sm:gap-3">
				{members.map((member) => (
					<div key={member.id} className="py-3 px-4 border border-border rounded-md bg-surface">
						<div className="font-medium text-text-base">{member.name || member.email}</div>
						<div className="text-[0.75rem] text-text-muted mb-1">{member.email}</div>
						<div className="text-[0.75rem] text-text-muted mb-2">Role: {member.role}</div>
						<div>
							<MemberGroupsCell member={member} groups={byUser.get(member.id) ?? []} />
						</div>
					</div>
				))}
			</div>
		</section>
	);
}
interface GroupListProps {
	groups: GroupSummary[];
	admin: boolean;
	busy: boolean;
	onSelect: (id: string) => void;
	onDelete: (id: string) => void;
}
function GroupsList({ groups, admin, busy, onSelect, onDelete }: GroupListProps) {
	const [deleteId, setDeleteId] = useState<string | null>(null);
	const name = (group: GroupSummary) =>
		admin ? (
			<button
				type="button"
				className="text-accent font-medium bg-transparent border-0 cursor-pointer p-0"
				onClick={() => onSelect(group.id)}
			>
				{group.name}
			</button>
		) : (
			<span className="font-medium text-text-base">{group.name}</span>
		);
	const remove = (group: GroupSummary) =>
		deleteId === group.id ? (
			<span className="inline-flex gap-2 items-center">
				<span className="text-xs text-text-muted">Delete group?</span>
				<Button variant="danger" size="sm" disabled={busy} onClick={() => onDelete(group.id)}>
					Yes
				</Button>
				<Button variant="outline" size="sm" disabled={busy} onClick={() => setDeleteId(null)}>
					No
				</Button>
			</span>
		) : (
			<Button variant="danger" size="sm" disabled={busy} onClick={() => setDeleteId(group.id)}>
				Delete
			</Button>
		);
	return (
		<>
			<div className="overflow-x-auto max-sm:hidden">
				<Table className="text-[0.85rem]">
					<TableHead>
						<TableRow>
							<TableHeaderCell>Name</TableHeaderCell>
							<TableHeaderCell>Members</TableHeaderCell>
							<TableHeaderCell>Projects</TableHeaderCell>
							{admin && <TableHeaderCell />}
						</TableRow>
					</TableHead>
					<TableBody>
						{groups.map((group) => (
							<TableRow key={group.id}>
								<TableCell>
									{name(group)}
									{group.description && (
										<p className="text-[0.75rem] text-text-muted m-0 mt-1">{group.description}</p>
									)}
								</TableCell>
								<TableCell>{group.memberCount}</TableCell>
								<TableCell>{group.grantCount}</TableCell>
								{admin && <TableCell>{remove(group)}</TableCell>}
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			<div className="hidden max-sm:flex max-sm:flex-col max-sm:gap-3">
				{groups.map((group) => (
					<div key={group.id} className="py-3 px-4 border border-border rounded-md bg-surface">
						<div className="flex justify-between items-center gap-2 mb-1">
							{name(group)}
							{admin && remove(group)}
						</div>
						{group.description && (
							<p className="text-[0.75rem] text-text-muted m-0 mb-1">{group.description}</p>
						)}
						<div className="text-[0.75rem] text-text-muted">
							{group.memberCount} members · {group.grantCount} projects
						</div>
					</div>
				))}
			</div>
		</>
	);
}
/** Details, membership and grant rows are prop-owned, while unsaved editor fields are local. */
function GroupDetailEditor({
	slug,
	detail,
	members,
	projects,
	onClose,
}: {
	slug: string;
	detail: GroupDetail;
	members: WorkspaceMember[];
	projects: ProjectLite[];
	onClose: () => void;
}) {
	const [operationBusy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [nameResult, nameAction, namePending] = useActionState(renameGroup, null);
	const [descriptionResult, descriptionAction, descriptionPending] = useActionState(
		describeGroup,
		null,
	);
	const [memberResult, memberAction, memberPending] = useActionState(addGroupMember, null);
	const [grantResult, grantAction, grantPending] = useActionState(createGroupGrant, null);
	const busy = operationBusy || namePending || descriptionPending || memberPending || grantPending;
	const defaults = useRef({
		name: { workspaceSlug: slug, groupId: detail.id, name: detail.name },
		description: { workspaceSlug: slug, groupId: detail.id, description: detail.description ?? "" },
		member: { workspaceSlug: slug, groupId: detail.id, userId: "" },
		grant: { workspaceSlug: slug, groupId: detail.id, projectId: "", role: "member" as GrantRole },
	}).current;
	const nameValidator = Schema.toStandardSchemaV1(RenameGroupInputSchema);
	const descriptionValidator = Schema.toStandardSchemaV1(GroupDescriptionInputSchema);
	const memberValidator = Schema.toStandardSchemaV1(GroupMemberInputSchema);
	const grantValidator = Schema.toStandardSchemaV1(GroupGrantInputSchema);
	const nameForm = useForm({
		defaultValues: defaults.name,
		validators: { onMount: nameValidator, onChange: nameValidator, onSubmit: nameValidator },
	});
	const descriptionForm = useForm({
		defaultValues: defaults.description,
		validators: {
			onMount: descriptionValidator,
			onChange: descriptionValidator,
			onSubmit: descriptionValidator,
		},
	});
	const memberForm = useForm({
		defaultValues: defaults.member,
		validators: { onMount: memberValidator, onChange: memberValidator, onSubmit: memberValidator },
	});
	const grantForm = useForm({
		defaultValues: defaults.grant,
		validators: { onMount: grantValidator, onChange: grantValidator, onSubmit: grantValidator },
	});
	useEffect(() => {
		if (memberResult?.ok) memberForm.reset();
	}, [memberResult, memberForm]);
	useEffect(() => {
		if (grantResult?.ok) grantForm.reset();
	}, [grantResult, grantForm]);
	const addable = members.filter(
		(member) => !adminRole(member.role) && !detail.members.some((row) => row.userId === member.id),
	);
	const grantable = projects.filter(
		(project) => !detail.grants.some((row) => row.projectId === project.id),
	);
	async function removeMember(userId: string) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			unwrapResult(await removeGroupMember({ workspaceSlug: slug, groupId: detail.id, userId }));
		} catch (cause) {
			setError(String(cause));
		} finally {
			setBusy(false);
		}
	}
	async function removeGrant(projectId: string) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			unwrapResult(await removeGroupGrant({ workspaceSlug: slug, groupId: detail.id, projectId }));
		} catch (cause) {
			setError(String(cause));
		} finally {
			setBusy(false);
		}
	}
	return (
		<section className={CARD}>
			<form className="flex flex-wrap items-center gap-2 mb-4" action={nameAction}>
				<input type="hidden" name="workspaceSlug" value={slug} />
				<input type="hidden" name="groupId" value={detail.id} />
				<label className="sr-only" htmlFor={`group-name-${detail.id}`}>
					Group name
				</label>
				<nameForm.Field name="name">
					{(field) => (
						<Input
							id={`group-name-${detail.id}`}
							name="name"
							className="max-w-[22rem]"
							value={field.state.value}
							maxLength={100}
							disabled={busy}
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.currentTarget.value)}
						/>
					)}
				</nameForm.Field>
				<nameForm.Subscribe
					selector={(state) => ({
						canSubmit: state.canSubmit,
						dirty: state.isDirty,
						errors: state.errors,
					})}
				>
					{({ canSubmit, dirty, errors }) => (
						<>
							<Button type="submit" variant="primary" disabled={busy || !canSubmit || !dirty}>
								Rename
							</Button>
							{dirty && <FormErrors errors={errors} />}
						</>
					)}
				</nameForm.Subscribe>
				{nameResult?.ok === false && (
					<p role="alert" className="text-danger-text text-xs">
						{nameResult.message}
					</p>
				)}
				<Button variant="outline" disabled={busy} onClick={onClose}>
					Close
				</Button>
			</form>
			<form className="mb-4" action={descriptionAction}>
				<input type="hidden" name="workspaceSlug" value={slug} />
				<input type="hidden" name="groupId" value={detail.id} />
				<label
					className="text-[0.8rem] font-semibold text-text-muted"
					htmlFor={`group-description-${detail.id}`}
				>
					Description
				</label>
				<descriptionForm.Field name="description">
					{(field) => (
						<Textarea
							id={`group-description-${detail.id}`}
							name="description"
							value={field.state.value}
							maxLength={500}
							disabled={busy}
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.currentTarget.value)}
						/>
					)}
				</descriptionForm.Field>
				<descriptionForm.Subscribe
					selector={(state) => ({
						canSubmit: state.canSubmit,
						dirty: state.isDirty,
						errors: state.errors,
					})}
				>
					{({ canSubmit, dirty, errors }) => (
						<>
							<Button
								type="submit"
								variant="outline"
								size="sm"
								className="mt-2"
								disabled={busy || !canSubmit || !dirty}
							>
								Save description
							</Button>
							{dirty && <FormErrors errors={errors} />}
						</>
					)}
				</descriptionForm.Subscribe>
				{descriptionResult?.ok === false && (
					<p role="alert" className="text-danger-text text-xs">
						{descriptionResult.message}
					</p>
				)}
			</form>
			{error && (
				<div role="alert" className="text-danger-text text-[0.8rem] mb-2">
					{error}
				</div>
			)}
			<h3 className="text-[0.85rem] font-semibold text-text-base mb-2">Members</h3>
			<div className="mb-2">
				{detail.members.length === 0 && (
					<div className="text-[0.8rem] text-text-muted mb-2">No members yet.</div>
				)}
				{detail.members.map((member) => (
					<div key={member.userId} className="flex items-center gap-2 mb-1">
						<span className={CHIP} style={{ margin: 0 }}>
							{member.name || member.email}
						</span>
						<Button
							variant="danger"
							size="sm"
							disabled={busy}
							aria-label={`Remove ${member.name || member.email}`}
							onClick={() => removeMember(member.userId)}
						>
							Remove
						</Button>
					</div>
				))}
			</div>
			<form className="flex items-center gap-2 mb-4" action={memberAction}>
				<input type="hidden" name="workspaceSlug" value={slug} />
				<input type="hidden" name="groupId" value={detail.id} />
				<memberForm.Field name="userId">
					{(field) => (
						<select
							className={INPUT}
							aria-label="Add a member"
							name="userId"
							value={field.state.value}
							disabled={busy}
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.currentTarget.value)}
						>
							<option value="">Add a member…</option>
							{addable.map((member) => (
								<option key={member.id} value={member.id}>
									{member.name || member.email}
								</option>
							))}
						</select>
					)}
				</memberForm.Field>
				<memberForm.Subscribe
					selector={(state) => ({
						canSubmit: state.canSubmit,
						dirty: state.isDirty,
						errors: state.errors,
					})}
				>
					{({ canSubmit, dirty, errors }) => (
						<>
							<Button type="submit" variant="primary" disabled={busy || !canSubmit}>
								Add
							</Button>
							{dirty && <FormErrors errors={errors} />}
						</>
					)}
				</memberForm.Subscribe>
				{memberResult?.ok === false && (
					<p role="alert" className="text-danger-text text-xs">
						{memberResult.message}
					</p>
				)}
			</form>
			<h3 className="text-[0.85rem] font-semibold text-text-base mb-2">Project grants</h3>
			<div className="mb-2">
				{detail.grants.length === 0 && (
					<div className="text-[0.8rem] text-text-muted mb-2">
						No grants. This group opens no projects.
					</div>
				)}
				{detail.grants.map((grant) => (
					<div key={grant.projectId} className="flex flex-wrap items-center gap-2 mb-1">
						<span className="text-[0.82rem] text-text-base min-w-[9rem]">
							{grant.projectName} <span className="text-text-muted">({grant.projectKey})</span>
						</span>
						<GrantRoleForm
							grant={grant}
							workspaceSlug={slug}
							groupId={detail.id}
							busy={busy}
							onBusy={setBusy}
							onError={setError}
						/>
						<Button
							variant="danger"
							size="sm"
							disabled={busy}
							aria-label={`Remove grant for ${grant.projectName}`}
							onClick={() => removeGrant(grant.projectId)}
						>
							Remove
						</Button>
					</div>
				))}
			</div>
			<form className="flex flex-wrap items-center gap-2" action={grantAction}>
				<input type="hidden" name="workspaceSlug" value={slug} />
				<input type="hidden" name="groupId" value={detail.id} />
				<grantForm.Field name="projectId">
					{(field) => (
						<select
							id={`group-grant-project-${detail.id}`}
							name="projectId"
							className={INPUT}
							aria-label="Grant a project"
							value={field.state.value}
							disabled={busy}
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.currentTarget.value)}
						>
							<option value="">Grant a project…</option>
							{grantable.map((project) => (
								<option key={project.id} value={project.id}>
									{project.name} ({project.key})
								</option>
							))}
						</select>
					)}
				</grantForm.Field>
				<grantForm.Field name="role">
					{(field) => (
						<select
							className={INPUT}
							aria-label="New grant role"
							name="role"
							value={field.state.value}
							disabled={busy}
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.currentTarget.value as GrantRole)}
						>
							{ROLES.map((role) => (
								<option key={role} value={role}>
									{role}
								</option>
							))}
						</select>
					)}
				</grantForm.Field>
				<grantForm.Subscribe
					selector={(state) => ({
						canSubmit: state.canSubmit,
						dirty: state.isDirty,
						errors: state.errors,
					})}
				>
					{({ canSubmit, dirty, errors }) => (
						<>
							<Button type="submit" variant="primary" disabled={busy || !canSubmit}>
								Grant
							</Button>
							{dirty && <FormErrors errors={errors} />}
						</>
					)}
				</grantForm.Subscribe>
				{grantResult?.ok === false && (
					<p role="alert" className="text-danger-text text-xs">
						{grantResult.message}
					</p>
				)}
			</form>
		</section>
	);
}

function GrantRoleForm({
	grant,
	workspaceSlug,
	groupId,
	busy,
	onBusy,
	onError,
}: {
	grant: GroupGrant;
	workspaceSlug: string;
	groupId: string;
	busy: boolean;
	onBusy: (busy: boolean) => void;
	onError: (error: string | null) => void;
}) {
	const defaults = useRef({
		workspaceSlug,
		groupId,
		projectId: grant.projectId,
		role: grant.role,
	}).current;
	const standard = Schema.toStandardSchemaV1(GroupGrantInputSchema);
	const form = useForm({
		defaultValues: defaults,
		validators: { onMount: standard, onChange: standard, onSubmit: standard },
		onSubmit: async ({ value }) => {
			onBusy(true);
			onError(null);
			try {
				unwrapResult(await setGroupGrant(value));
			} catch (cause) {
				onError(String(cause));
			} finally {
				onBusy(false);
			}
		},
	});
	return (
		<form
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<form.Field name="role">
				{(field) => (
					<select
						className={INPUT}
						aria-label={`Role for ${grant.projectName}`}
						value={grant.role}
						disabled={busy}
						onBlur={field.handleBlur}
						onChange={(event) => {
							field.handleChange(event.currentTarget.value as GrantRole);
							void form.handleSubmit();
						}}
					>
						{ROLES.map((role) => (
							<option key={role} value={role}>
								{role}
							</option>
						))}
					</select>
				)}
			</form.Field>
		</form>
	);
}

export function GroupManager({
	workspaceSlug,
	initialData: data,
	view = "groups",
}: {
	workspaceSlug: string;
	initialData: GroupData;
	view?: GroupView;
}) {
	const [selected, setSelected] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [operationBusy, setBusy] = useState(false);
	const [createResult, createAction, createPending] = useActionState(createGroup, null);
	const busy = operationBusy || createPending;
	const tabRefs = useRef<Partial<Record<Tab, HTMLAnchorElement | null>>>({});
	const admin = adminRole(data.role);
	const tabs: Tab[] = admin ? ["members", "groups"] : ["groups"];
	const activeTab = admin ? view : "groups";
	const detail = data.details.find((item) => item.id === selected);
	const defaults = useRef({ workspaceSlug, name: "" }).current;
	const standard = Schema.toStandardSchemaV1(CreateGroupInputSchema);
	const form = useForm({
		defaultValues: defaults,
		validators: { onMount: standard, onChange: standard, onSubmit: standard },
	});
	useEffect(() => {
		if (createResult?.ok) form.reset();
	}, [createResult, form]);
	async function remove(id: string) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			unwrapResult(await deleteGroup({ workspaceSlug, groupId: id }));
			if (selected === id) setSelected(null);
		} catch (cause) {
			setError(String(cause));
		} finally {
			setBusy(false);
		}
	}
	function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		const next = nextTabId(tabs, activeTab, event.key);
		if (next) {
			event.preventDefault();
			tabRefs.current[next]?.focus();
		}
	}
	const groups = (
		<>
			<section className={CARD}>
				<h2 className={H2}>{admin ? "Groups" : "Your groups"}</h2>
				{admin && (
					<form className="flex items-center gap-2 mb-4" action={createAction}>
						<input type="hidden" name="workspaceSlug" value={workspaceSlug} />
						<form.Field name="name">
							{(field) => (
								<Input
									aria-label="New group name"
									name="name"
									placeholder="New group name"
									value={field.state.value}
									maxLength={100}
									disabled={busy}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.currentTarget.value)}
								/>
							)}
						</form.Field>
						<form.Subscribe
							selector={(state) => ({
								canSubmit: state.canSubmit,
								dirty: state.isDirty,
								errors: state.errors,
							})}
						>
							{({ canSubmit, dirty, errors }) => (
								<>
									<Button type="submit" variant="primary" disabled={busy || !canSubmit}>
										Create group
									</Button>
									{dirty && <FormErrors errors={errors} />}
								</>
							)}
						</form.Subscribe>
					</form>
				)}
				{createResult?.ok === false && (
					<div role="alert" className="text-danger-text text-[0.8rem] mb-2">
						{createResult.message}
					</div>
				)}
				{data.groups.length === 0 ? (
					<EmptyState
						title={
							admin
								? "No groups yet."
								: "You don't belong to any groups yet. An owner or admin can add you to one."
						}
					/>
				) : (
					<GroupsList
						groups={data.groups}
						admin={admin}
						busy={busy}
						onSelect={setSelected}
						onDelete={remove}
					/>
				)}
			</section>
			{admin && detail && (
				<GroupDetailEditor
					key={detail.id}
					slug={workspaceSlug}
					detail={detail}
					members={data.members}
					projects={data.projects}
					onClose={() => setSelected(null)}
				/>
			)}
		</>
	);
	return (
		<div>
			<div className={INFO}>
				<span className={ROLE_TAG}>{data.role}</span>
				<span>
					{admin
						? "You manage which groups can access which projects."
						: "Only owners and admins manage groups. Below are the groups that grant you access."}
				</span>
			</div>
			{error && (
				<p role="alert" className="text-danger-text">
					{error}
				</p>
			)}
			{tabs.length > 1 && (
				<div
					role="tablist"
					aria-label="Groups"
					className="flex gap-1 border-b border-border mb-4"
					onKeyDown={onTabKeyDown}
				>
					{tabs.map((id) => (
						<a
							key={id}
							ref={(element) => {
								tabRefs.current[id] = element;
							}}
							href={`/settings/groups?${new URLSearchParams({ workspace: workspaceSlug, view: id })}`}
							role="tab"
							id={`group-tab-${id}`}
							aria-selected={activeTab === id}
							aria-controls={`group-tabpanel-${id}`}
							tabIndex={activeTab === id ? 0 : -1}
							className={`px-4 py-2 text-[0.85rem] font-semibold border-b-2 -mb-px bg-transparent cursor-pointer ${activeTab === id ? "border-accent text-text-base" : "border-transparent text-text-muted hover:text-text-base"}`}
						>
							{id === "members" ? "Members" : "Groups"}
						</a>
					))}
				</div>
			)}
			{admin && activeTab === "members" && (
				<div role="tabpanel" id="group-tabpanel-members" aria-labelledby="group-tab-members">
					<MembersOverview members={data.members} memberGroups={data.memberGroups} />
				</div>
			)}
			{activeTab === "groups" &&
				(admin ? (
					<div role="tabpanel" id="group-tabpanel-groups" aria-labelledby="group-tab-groups">
						{groups}
					</div>
				) : (
					groups
				))}
		</div>
	);
}
