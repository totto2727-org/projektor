import { Effect } from "effect";
import { HttpClientRequest } from "effect/http";
import { vi } from "vite-plus/test";
import { RequestServices } from "../../../request";
import type { RequestApi } from "../../../server/api-client";
import type { RequestScope } from "../../../server/request-context";
import { createTestDatabase } from "../../../test/database";
import { project, scope, secondProject, workspace } from "./fixtures";

/** Actual migrated relational database and native SQLite FTS5, never a HTTP-shaped read fake. */
export function issueDataFixture() {
	const database = createTestDatabase();
	const { db, sqlite } = database;
	sqlite.exec(`
		INSERT INTO users (id,email,name,created_at) VALUES ('user-a','user@example.test','User',1);
		INSERT INTO workspaces (id,name,slug,created_at) VALUES ('workspace-a','Workspace','workspace',1), ('workspace-b','Other','other',1);
		INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('workspace-a','user-a','member',1), ('workspace-b','user-a','member',1);
		INSERT INTO projects (id,workspace_id,name,key,slug,created_at,updated_at) VALUES
			('project-a','workspace-a','Project A','A','a',1,1), ('project-b','workspace-a','Project B','B','b',1,1),
			('hidden-project','workspace-a','Hidden project','H','hidden',1,1), ('other-project','workspace-b','Other project','O','other',1,1);
		INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('group-a','workspace-a','Members',1), ('group-b','workspace-b','Others',1);
		INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('group-a','user-a','user-a',1), ('group-b','user-a','user-a',1);
		INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('group-a','project-a','member'), ('group-a','project-b','member'), ('group-b','other-project','member');
		INSERT INTO task_statuses (id,workspace_id,key,name,category,position,is_default) VALUES ('todo','workspace-a','todo','Todo','todo',0,1), ('done','workspace-a','done','Done','done',1,0);
		INSERT INTO task_types (id,workspace_id,key,name,position,is_default) VALUES ('epic-type','workspace-a','epic','Epic',0,0), ('task-type','workspace-a','task','Task',1,1);
		INSERT INTO custom_field_definitions (id,workspace_id,key,label,type,created_at) VALUES ('points','workspace-a','story_points','Story points','number',1);
		CREATE VIRTUAL TABLE issues_fts USING fts5(issue_id UNINDEXED, workspace_id UNINDEXED, title, body);
		CREATE VIRTUAL TABLE wiki_fts USING fts5(page_id UNINDEXED, workspace_id UNINDEXED, title, content, tags);
	`);
	function insertIssue(values: {
		id: string;
		number?: number;
		projectId?: string;
		workspaceId?: string;
		title?: string;
		body?: string;
		assigneeId?: string | null;
		parentId?: string | null;
		typeId?: string | null;
		createdAt?: number;
		statusId?: string;
		priority?: string;
		completedAt?: number | null;
		updatedAt?: number;
	}) {
		const workspaceId = values.workspaceId ?? workspace.id;
		const title = values.title ?? "Original issue";
		const body = values.body ?? "**Original description**";
		sqlite
			.prepare(
				`INSERT INTO issues (id,workspace_id,project_id,number,title,body,status,priority,assignee_id,parent_id,type_id,status_id,status_category,created_by_id,created_at,updated_at,completed_at,labels) VALUES (?,?,?,?,?,?,'todo',?,?,?,?,?,'todo','user-a',?,?,?,'[]')`,
			)
			.run(
				values.id,
				workspaceId,
				values.projectId ?? project.id,
				values.number ?? 1,
				title,
				body,
				values.priority ?? "medium",
				values.assigneeId ?? null,
				values.parentId ?? null,
				values.typeId ?? null,
				workspaceId === workspace.id ? (values.statusId ?? "todo") : null,
				values.createdAt ?? 1,
				values.updatedAt ?? 1,
				values.completedAt ?? null,
			);
		sqlite
			.prepare("INSERT INTO issues_fts (issue_id,workspace_id,title,body) VALUES (?,?,?,?)")
			.run(values.id, workspaceId, title, body);
	}
	insertIssue({ id: "issue-a", assigneeId: scope.user.id });
	insertIssue({
		id: "issue-b",
		projectId: secondProject.id,
		title: "Second project issue",
		createdAt: 2,
	});
	insertIssue({
		id: "hidden-issue",
		projectId: "hidden-project",
		title: "Hidden secret",
		createdAt: 3,
	});
	insertIssue({
		id: "other-issue",
		projectId: "other-project",
		workspaceId: "workspace-b",
		title: "Other membership issue",
		assigneeId: scope.user.id,
		createdAt: 4,
	});
	sqlite.exec(`
		INSERT INTO custom_field_values (issue_id,field_id,value) VALUES ('issue-a','points','3');
		INSERT INTO issue_comments (id,issue_id,author_id,body,created_at,updated_at) VALUES ('comment-a','issue-a','user-a','Existing comment',1,1);
		INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,url,entity_type,entity_id,created_by_id,created_at) VALUES ('file-a','workspace-a','url','','Reference','text/uri-list',0,'https://example.test/reference','issue','issue-a','user-a',1);
		INSERT INTO wiki_pages (id,workspace_id,slug,title,content,project_id,created_by_id,updated_by_id,created_at,updated_at) VALUES
			('wiki-a','workspace-a','guide','Visible guide','Guide content','project-a','user-a','user-a',1,1),
			('wiki-hidden','workspace-a','secret','Hidden guide','Guide content','hidden-project','user-a','user-a',1,1),
			('wiki-global','workspace-a','workspace-guide','Workspace guide','Guide content',NULL,'user-a','user-a',1,1);
		INSERT INTO wiki_fts (page_id,workspace_id,title,content,tags) SELECT id,workspace_id,title,content,'[]' FROM wiki_pages;
	`);
	const api: RequestApi = {
		get: (path) => HttpClientRequest.get(path),
		send: (path, options) => HttpClientRequest.make(options.method)(path),
		raw: (path) => HttpClientRequest.get(path),
		execute: () => Effect.die("Issue DB loaders must not use the API binding."),
	};
	const request = new Request("https://front.test/issues?workspace=workspace");
	const invalidated = vi.fn();
	function services(requestScope: RequestScope = scope): typeof RequestServices.Service {
		return {
			request,
			env: { API_BASE: "https://api.test", DB: db },
			url: new URL(request.url),
			api,
			db,
			scope: () => Effect.succeed(requestScope),
			prepare: (view) => view,
			invalidate: Effect.sync(invalidated),
		};
	}
	function run<A, E>(
		operation: Effect.Effect<A, E, RequestServices>,
		requestScope: RequestScope = scope,
	) {
		return Effect.runPromise(
			operation.pipe(Effect.provideService(RequestServices, services(requestScope))),
		);
	}
	return { ...database, api, insertIssue, services, run, invalidated };
}
