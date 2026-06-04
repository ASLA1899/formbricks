import { NextRequest } from "next/server";
import { logger } from "@formbricks/logger";
import { DatabaseError, InvalidInputError, ResourceNotFoundError } from "@formbricks/types/errors";
import { responses } from "@/app/lib/api/response";
import { withV1ApiWrapper } from "@/app/lib/api/with-api-logging";
import { getResponse } from "@/lib/response/service";
import { putResponseHandler } from "./lib/put-response-handler";

export const OPTIONS = async (): Promise<Response> => {
  return responses.successResponse({}, true);
};

// Public read of an in-progress response so users can resume a link survey
// from another session on the same device. Only returns when:
//   - the response exists,
//   - the surveyId query param matches the response's surveyId, and
//   - the response is NOT finished.
// Once finished, treat as not-found so completed (potentially PII-bearing)
// responses cannot be read back through this endpoint.
export const GET = withV1ApiWrapper({
  handler: async ({
    req,
    props,
  }: {
    req: NextRequest;
    props: { params: Promise<{ responseId: string }> };
  }) => {
    const params = await props.params;
    const { responseId } = params;
    const url = new URL(req.url);
    const surveyId = url.searchParams.get("surveyId");

    if (!responseId || !surveyId) {
      return {
        response: responses.badRequestResponse("responseId and surveyId are required", undefined, true),
      };
    }

    let response;
    try {
      response = await getResponse(responseId);
    } catch (error) {
      const endpoint = "GET /api/v1/client/[environmentId]/responses/[responseId]";
      return {
        response: handleDatabaseError(error, req.url, endpoint, responseId),
      };
    }

    if (!response || response.surveyId !== surveyId || response.finished) {
      return {
        response: responses.notFoundResponse("Response", responseId, true),
      };
    }

    return {
      response: responses.successResponse(
        {
          id: response.id,
          surveyId: response.surveyId,
          data: response.data,
          ttc: response.ttc,
          variables: response.variables,
          language: response.language,
        },
        true
      ),
    };
  },
});

const handleDatabaseError = (error: unknown, url: string, endpoint: string, responseId: string): Response => {
  if (error instanceof ResourceNotFoundError) {
    return responses.notFoundResponse("Response", responseId, true);
  }
  if (error instanceof InvalidInputError) {
    return responses.badRequestResponse(error.message, undefined, true);
  }
  if (error instanceof DatabaseError) {
    logger.error({ error, url }, `Error in ${endpoint}`);
    return responses.internalServerErrorResponse(error.message, true);
  }
  return responses.internalServerErrorResponse("Unknown error occurred", true);
};

export const PUT = withV1ApiWrapper({
  handler: putResponseHandler,
});
