import { NextRequest } from "next/server";
import { TAuthenticationApiKey } from "@formbricks/types/auth";
import { type ApiErrorResult, handleApiError } from "@/app/lib/api/handle-api-error";
import { responses } from "@/app/lib/api/response";
import {
  type AuthenticateApiKeyOptions,
  authenticateApiKeyFromHeaders,
} from "@/modules/api/lib/api-key-auth";

<<<<<<< HEAD
export const authenticateRequest = async (
  request: NextRequest,
  options: AuthenticateApiKeyOptions = {}
): Promise<TAuthenticationApiKey | null> => {
  return await authenticateApiKeyFromHeaders(request.headers, options);
};

export const handleErrorResponse = (error: unknown): ApiErrorResult => {
  const message = error instanceof Error ? error.message : undefined;
  switch (message) {
=======
type AuthenticateApiKeyOptions = {
  allowOrganizationOnlyApiKey?: boolean;
};

export const authenticateApiKey = async (
  apiKey: string,
  options: AuthenticateApiKeyOptions = {}
): Promise<TAuthenticationApiKey | null> => {
  const apiKeyData = await getApiKeyWithPermissions(apiKey);
  if (!apiKeyData) return null;

  if (!options.allowOrganizationOnlyApiKey && apiKeyData.apiKeyEnvironments.length === 0) {
    return null;
  }

  // In the route handlers, we'll do more specific permission checks
  const authentication: TAuthenticationApiKey = {
    type: "apiKey",
    environmentPermissions: apiKeyData.apiKeyEnvironments.map((env) => ({
      environmentId: env.environmentId,
      environmentType: env.environment.type,
      permission: env.permission,
      projectId: env.environment.projectId,
      projectName: env.environment.project.name,
    })),
    apiKeyId: apiKeyData.id,
    organizationId: apiKeyData.organizationId,
    organizationAccess: apiKeyData.organizationAccess,
  };

  return authentication;
};

export const authenticateRequest = async (
  request: NextRequest,
  options: AuthenticateApiKeyOptions = {}
): Promise<TAuthenticationApiKey | null> => {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey) return null;

  return authenticateApiKey(apiKey, options);
};

export const handleErrorResponse = (error: any): Response => {
  switch (error.message) {
>>>>>>> origin/main
    case "NotAuthenticated":
      return { response: responses.notAuthenticatedResponse() };
    case "Unauthorized":
      return { response: responses.unauthorizedResponse() };
    default:
      // Delegate to the shared boundary and return its full { response, error } result — not just
      // `.response` — so the wrapper's reportApiError receives the real 5xx error (e.g. a
      // DatabaseError) instead of a synthetic one. Expected 4xx errors keep their status/message.
      return handleApiError(error);
  }
};
