import { headers } from "next/headers";
import { prisma } from "@formbricks/database";
import { authenticateApiKey } from "@/app/api/v1/auth";
import { buildApiKeyMeResponse } from "@/app/api/v1/management/me/lib/api-key-response";
import { getSessionUser } from "@/app/api/v1/management/me/lib/utils";
import { responses } from "@/app/lib/api/response";
import { publicUserSelect } from "@/lib/user/public-user";
import { applyRateLimit } from "@/modules/core/rate-limit/helpers";
import { rateLimitConfigs } from "@/modules/core/rate-limit/rate-limit-configs";

<<<<<<< HEAD
const ALLOWED_PERMISSIONS = ["manage", "read", "write"] as const;

const apiKeySelect = {
  id: true,
  organizationId: true,
  lastUsedAt: true,
  apiKeyWorkspaces: {
    select: {
      workspace: {
        select: {
          id: true,
          organizationId: true,
          legacyEnvironmentId: true,
          createdAt: true,
          updatedAt: true,
          name: true,
          appSetupCompleted: true,
        },
      },
      permission: true,
    },
  },
  hashedKey: true,
};

type ApiKeyData = {
  id: string;
  hashedKey: string;
  organizationId: string;
  lastUsedAt: Date | null;
  apiKeyWorkspaces: Array<{
    permission: string;
    workspace: {
      id: string;
      organizationId: string;
      legacyEnvironmentId: string | null;
      createdAt: Date;
      updatedAt: Date;
      name: string;
      appSetupCompleted: boolean;
    };
  }>;
};

const validateApiKey = async (apiKey: string): Promise<ApiKeyData | null> => {
  const v2Parsed = parseApiKeyV2(apiKey);

  const apiKeyData = v2Parsed ? await validateV2ApiKey(v2Parsed) : await validateLegacyApiKey(apiKey);
  if (!apiKeyData) {
    return null;
  }

  // ENG-1749: drop workspace permissions outside the key's organization (defense-in-depth,
  // mirroring authenticateApiKeyFromHeaders) so a pre-fix cross-org row can't leak workspace
  // metadata through this legacy route.
  return {
    ...apiKeyData,
    apiKeyWorkspaces: apiKeyData.apiKeyWorkspaces.filter(
      (workspacePermission) => workspacePermission.workspace.organizationId === apiKeyData.organizationId
    ),
  };
};

const validateV2ApiKey = async (v2Parsed: { secret: string }): Promise<ApiKeyData | null> => {
  // Step 1: Fast SHA-256 lookup by indexed lookupHash
  const lookupHash = hashSha256(v2Parsed.secret);

  const apiKeyData = await prisma.apiKey.findUnique({
    where: { lookupHash },
    select: apiKeySelect,
  });

  // Step 2: Security verification with bcrypt
  // Always perform bcrypt verification to prevent timing attacks
  // Use a control hash when API key doesn't exist to maintain constant timing
  const hashToVerify = apiKeyData?.hashedKey || CONTROL_HASH;
  const isValid = await verifySecret(v2Parsed.secret, hashToVerify);

  if (!apiKeyData || !isValid) return null;

  return apiKeyData;
};

const validateLegacyApiKey = async (apiKey: string): Promise<ApiKeyData | null> => {
  const hashedKey = hashSha256(apiKey);
  const result = await prisma.apiKey.findFirst({
    where: { hashedKey },
    select: apiKeySelect,
  });
  return result;
};

=======
>>>>>>> origin/main
const checkRateLimit = async (userId: string) => {
  try {
    await applyRateLimit(rateLimitConfigs.api.v1, userId);
  } catch (error) {
    return responses.tooManyRequestsResponse(
      error instanceof Error ? error.message : "Unknown error occurred"
    );
  }
  return null;
};

<<<<<<< HEAD
const updateApiKeyUsage = async (apiKeyId: string) => {
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { lastUsedAt: new Date() },
  });
};

const buildWorkspaceResponse = (apiKeyData: ApiKeyData) => {
  const workspace = apiKeyData.apiKeyWorkspaces[0].workspace;
  return Response.json({
    // Keep v1 payload shape stable while sourcing data from workspace.
    id: workspace.legacyEnvironmentId ?? workspace.id,
    type: "production",
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    appSetupCompleted: workspace.appSetupCompleted,
    workspace: {
      id: workspace.id,
      name: workspace.name,
    },
    // Backwards compat: old consumers expect project fields
    project: {
      id: workspace.id,
      name: workspace.name,
    },
  });
};

const isValidApiKeyEnvironment = (apiKeyData: ApiKeyData): boolean => {
  return (
    apiKeyData.apiKeyWorkspaces.length === 1 &&
    ALLOWED_PERMISSIONS.includes(
      apiKeyData.apiKeyWorkspaces[0].permission as (typeof ALLOWED_PERMISSIONS)[number]
    )
  );
};

=======
>>>>>>> origin/main
const handleApiKeyAuthentication = async (apiKey: string) => {
  const authentication = await authenticateApiKey(apiKey, { allowOrganizationOnlyApiKey: true });

  if (!authentication) {
    return responses.notAuthenticatedResponse();
  }

<<<<<<< HEAD
  if (!apiKeyData.lastUsedAt || apiKeyData.lastUsedAt <= new Date(Date.now() - 1000 * 30)) {
    // Fire-and-forget: update lastUsedAt in the background without blocking the response
    updateApiKeyUsage(apiKeyData.id).catch((error) => {
      console.error("Failed to update API key usage:", error);
    });
  }

  // Rate limiting for apiKey auth is enforced by Envoy in v5 — see envoy-rate-limit-coverage.ts
  if (!isValidApiKeyEnvironment(apiKeyData)) {
    // This legacy endpoint returns a single workspace's (environment's) details, so it only works
    // for keys scoped to exactly one workspace. Organization-only keys (no workspace) and keys with
    // multiple workspaces land here — point them at the v2 endpoint that returns full permissions.
    return responses.badRequestResponse(
      "This endpoint only supports API keys that are scoped to a single workspace. Use GET /api/v2/me to inspect organization-level API keys or keys with access to multiple workspaces."
    );
  }

  return buildWorkspaceResponse(apiKeyData);
=======
  const rateLimitError = await checkRateLimit(authentication.apiKeyId);
  if (rateLimitError) return rateLimitError;

  const apiKeyMeResponse = await buildApiKeyMeResponse(authentication);

  if (!apiKeyMeResponse) {
    return responses.badRequestResponse("You can't use this method with this API key");
  }

  return apiKeyMeResponse;
>>>>>>> origin/main
};

const handleSessionAuthentication = async () => {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return responses.notAuthenticatedResponse();
  }

  const rateLimitError = await checkRateLimit(sessionUser.id);
  if (rateLimitError) return rateLimitError;

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
<<<<<<< HEAD
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      createdAt: true,
      updatedAt: true,
      twoFactorEnabled: true,
      identityProvider: true,
      notificationSettings: true,
      locale: true,
      lastLoginAt: true,
      isActive: true,
    },
=======
    select: publicUserSelect,
>>>>>>> origin/main
  });

  return Response.json(user);
};

export const GET = async () => {
  const headersList = await headers();
  const apiKey = headersList.get("x-api-key");

  if (apiKey) {
    return handleApiKeyAuthentication(apiKey);
  }

  return handleSessionAuthentication();
};
