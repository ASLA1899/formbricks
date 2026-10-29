/**
 * /api/v3/surveys - list and create block-based survey management resources.
 * Session cookie or x-api-key; scope by workspaceId only.
 */
import { withV3ApiWrapper } from "@/app/api/v3/lib/api-wrapper";
import { createV3SurveyResponse, listV3Surveys } from "./lib/operations";
import { ZV3CreateSurveyBody, ZV3CreateSurveyQuery } from "./schemas";

export const GET = withV3ApiWrapper({
  auth: "both",
  handler: async ({ req, authentication, requestId, instance }) => {
    return await listV3Surveys({
      searchParams: new URL(req.url).searchParams,
      authentication,
      requestId,
      instance,
    });
  },
});

<<<<<<< HEAD
export const POST = withV3ApiWrapper({
  auth: "both",
  schemas: {
    body: ZV3CreateSurveyBody,
    query: ZV3CreateSurveyQuery,
  },
  action: "created",
  targetType: "survey",
  handler: async ({ authentication, auditLog, parsedInput, requestId, instance }) => {
    return await createV3SurveyResponse({
      body: parsedInput.body,
      authentication,
      requestId,
      instance,
      auditLog,
      createdFrom: parsedInput.query?.createdFrom,
    });
=======
    try {
      const searchParams = new URL(req.url).searchParams;
      const parsed = parseV3SurveysListQuery(searchParams);
      if (!parsed.ok) {
        log.warn({ statusCode: 400, invalidParams: parsed.invalid_params }, "Validation failed");
        return problemBadRequest(requestId, "Invalid query parameters", {
          invalid_params: parsed.invalid_params,
          instance,
        });
      }

      const authResult = await requireV3WorkspaceAccess(
        authentication,
        parsed.workspaceId,
        "read",
        requestId,
        instance
      );
      if (authResult instanceof Response) {
        return authResult;
      }

      const { environmentId } = authResult;

      const [{ surveys, nextCursor }, totalCount] = await Promise.all([
        getSurveyListPage(environmentId, {
          limit: parsed.limit,
          cursor: parsed.cursor,
          sortBy: parsed.sortBy,
          filterCriteria: parsed.filterCriteria,
        }),
        getSurveyCount(environmentId, undefined, parsed.filterCriteria),
      ]);

      return successListResponse(
        surveys.map(serializeV3SurveyListItem),
        {
          limit: parsed.limit,
          nextCursor,
          totalCount,
        },
        { requestId, cache: "private, no-store" }
      );
    } catch (err) {
      if (err instanceof ResourceNotFoundError) {
        log.warn({ statusCode: 403, errorCode: err.name }, "Resource not found");
        return problemForbidden(requestId, "You are not authorized to access this resource", instance);
      }
      if (err instanceof DatabaseError) {
        log.error({ error: err, statusCode: 500 }, "Database error");
        return problemInternalError(requestId, "An unexpected error occurred.", instance);
      }
      log.error({ error: err, statusCode: 500 }, "V3 surveys list unexpected error");
      return problemInternalError(requestId, "An unexpected error occurred.", instance);
    }
>>>>>>> origin/main
  },
});
