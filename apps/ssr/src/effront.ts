import { Application } from "@effront/core";
import type { HttpClient } from "effect/unstable/http";
import type { RequestServices } from "./request";

export const EFFRONT = Application.effront<RequestServices | HttpClient.HttpClient>();
