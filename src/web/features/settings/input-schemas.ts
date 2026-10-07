import { Schema } from "effect";

export const GroupViewSchema = Schema.Literals(["groups", "members"]);
export type GroupView = typeof GroupViewSchema.Type;

const required = (label: string, maximum = 200) =>
	Schema.String.check(
		Schema.isMaxLength(maximum),
		Schema.makeFilter((value) => value.trim().length > 0 || `${label} is required.`),
	);
export const SettingsScopeFields = { workspaceSlug: required("Workspace") };
export const GroupNameFields = { name: required("Group name", 100) };
export const CreateGroupInputSchema = Schema.Struct({ ...SettingsScopeFields, ...GroupNameFields });
export const GroupIdentitySchema = Schema.Struct({
	...SettingsScopeFields,
	groupId: required("Group"),
});
export const RenameGroupInputSchema = Schema.Struct({
	...GroupIdentitySchema.fields,
	...GroupNameFields,
});
export const GroupDescriptionInputSchema = Schema.Struct({
	...GroupIdentitySchema.fields,
	description: Schema.String.check(Schema.isMaxLength(500)),
});
export const GroupMemberInputSchema = Schema.Struct({
	...GroupIdentitySchema.fields,
	userId: required("Member"),
});
export const GrantRoleSchema = Schema.Literals(["viewer", "member", "admin"]);
export const GroupProjectIdentitySchema = Schema.Struct({
	...GroupIdentitySchema.fields,
	projectId: required("Project"),
});
export const GroupGrantInputSchema = Schema.Struct({
	...GroupProjectIdentitySchema.fields,
	role: GrantRoleSchema,
});
export const CreateTokenInputSchema = Schema.Struct({
	...SettingsScopeFields,
	name: required("Name", 100),
	scope: Schema.Literals(["read", "readwrite"]),
	expiry: Schema.String.check(
		Schema.makeFilter(
			(value) =>
				value === "" ||
				(/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 365) ||
				"Expiry must be a whole number from 1 to 365, or blank.",
		),
	),
});
export const TokenIdentitySchema = Schema.Struct({
	...SettingsScopeFields,
	tokenId: required("Token"),
});
export const ConnectorIdentitySchema = Schema.Struct({
	...SettingsScopeFields,
	connectorId: required("Connector"),
});
export const NewTokenSchema = Schema.Struct({
	id: Schema.String,
	token: Schema.String,
	name: Schema.String,
	scopes: Schema.Array(Schema.String).pipe(Schema.mutable),
	expiresAt: Schema.NullOr(Schema.Finite),
});
