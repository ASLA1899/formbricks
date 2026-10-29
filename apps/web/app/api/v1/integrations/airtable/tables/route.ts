import * as z from "zod";
import { responses } from "@/app/lib/api/response";
import { withV1ApiWrapper } from "@/app/lib/api/with-api-logging";
import { getAirtableToken, getTables } from "@/lib/airtable/service";
<<<<<<< HEAD
=======
import { hasUserEnvironmentAccess } from "@/lib/environment/auth";
>>>>>>> origin/main
import { getIntegrationByType } from "@/lib/integration/service";
import { canUserReadWorkspaceIntegrations } from "@/lib/workspace/auth";

export const GET = withV1ApiWrapper({
  handler: async ({ req, authentication }) => {
    if (!authentication || !("user" in authentication)) {
      return { response: responses.notAuthenticatedResponse() };
    }

    const url = req.url;
    const workspaceId = req.headers.get("workspaceId");
    const queryParams = new URLSearchParams(url.split("?")[1]);
    const baseId = z.string().safeParse(queryParams.get("baseId"));

    if (!baseId.success) {
      return {
        response: responses.badRequestResponse("Base Id is Required"),
      };
    }

    if (!workspaceId) {
      return {
        response: responses.badRequestResponse("workspaceId is missing"),
      };
    }

    const canUserAccessWorkspace = await canUserReadWorkspaceIntegrations(
      authentication.user.id,
      workspaceId
    );
    if (!canUserAccessWorkspace) {
      return {
        response: responses.unauthorizedResponse(),
      };
    }

<<<<<<< HEAD
    const integration = await getIntegrationByType(workspaceId, "airtable");
=======
    const integration = await getIntegrationByType(environmentId, "airtable");
>>>>>>> origin/main

    if (!integration) {
      return {
        response: responses.notFoundResponse("Integration not found", null),
      };
    }

    // Use getAirtableToken to ensure the access token is refreshed if expired
<<<<<<< HEAD
    const freshAccessToken = await getAirtableToken(workspaceId);
=======
    const freshAccessToken = await getAirtableToken(environmentId);
>>>>>>> origin/main
    const tables = await getTables(
      { ...integration.config.key, access_token: freshAccessToken },
      baseId.data
    );
    return {
      response: responses.successResponse(tables),
    };
  },
});
