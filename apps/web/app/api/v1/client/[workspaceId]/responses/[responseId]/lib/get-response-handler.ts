import { ResourceNotFoundError } from "@formbricks/types/errors";
import { type ApiErrorResult, handleApiError } from "@/app/lib/api/handle-api-error";
import { responses } from "@/app/lib/api/response";
import { THandlerParams } from "@/app/lib/api/with-api-logging";
import { getResponse } from "@/lib/response/service";
import { getSurvey } from "@/lib/survey/service";
import { resolveClientApiIds } from "@/lib/utils/resolve-client-id";
import { verifyLinkSurveyPinToken } from "@/modules/survey/link/lib/pin-token";
import { VERIFIED_EMAIL_RESPONSE_KEY } from "@/modules/survey/link/lib/verify-email-gate";

export const PIN_TOKEN_HEADER = "x-pin-auth-token";

/** Server-side resume window. Matches the browser's retention so an old id stops working for good. */
export const RESUME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type TGetRouteParams = { params: Promise<{ workspaceId: string; responseId: string }> };

/**
 * Public read of an UNFINISHED link-survey response so a respondent can resume from the same browser.
 * Every failed check returns the same 404, so the endpoint does not reveal whether an id exists.
 * Served only when the response belongs to the surveyId query param, the survey belongs to the
 * workspace in the path and is in progress, a PIN survey's PIN token is valid, and the response is
 * not finished. Finished responses are never returned.
 */
export const getResponseHandler = async ({
  req,
  props,
}: THandlerParams<TGetRouteParams>): Promise<ApiErrorResult> => {
  const { workspaceId: workspaceIdParam, responseId } = await props.params;
  const surveyId = new URL(req.url).searchParams.get("surveyId");

  if (!responseId || !surveyId) {
    return {
      response: responses.badRequestResponse("responseId and surveyId are required", undefined, true),
    };
  }

  const notFound = { response: responses.notFoundResponse("Response", responseId, true) };

  try {
    const resolved = await resolveClientApiIds(workspaceIdParam);
    if (!resolved) return notFound;

    const response = await getResponse(responseId);
    if (!response || response.surveyId !== surveyId || response.finished) return notFound;
    // Contact and single-use responses are tracked server-side; the client never resumes them.
    if (response.contact?.id || response.singleUseId) return notFound;
    // The window runs from creation, which no public write can change. updatedAt would let a PUT
    // renew an expired response.
    if (Date.now() - new Date(response.createdAt).getTime() > RESUME_MAX_AGE_MS) return notFound;

    const survey = await getSurvey(surveyId);
    if (!survey || survey.workspaceId !== resolved.workspaceId || survey.status !== "inProgress") {
      return notFound;
    }
    // Email-verified surveys resume only through their own gate, so a stored id cannot skip it.
    if (survey.type !== "link" || survey.isVerifyEmailEnabled) return notFound;
    // Single-use may have been switched on after this anonymous response was created.
    if (survey.singleUse?.enabled) return notFound;
    if (survey.pin && !verifyLinkSurveyPinToken(req.headers.get(PIN_TOKEN_HEADER), survey.id)) {
      return notFound;
    }

    const { [VERIFIED_EMAIL_RESPONSE_KEY]: _verifiedEmail, ...data } = response.data;

    return {
      response: responses.successResponse(
        {
          id: response.id,
          surveyId: response.surveyId,
          data,
          ttc: response.ttc,
          variables: response.variables,
          language: response.language,
        },
        true
      ),
    };
  } catch (error) {
    if (error instanceof ResourceNotFoundError) return notFound;
    return handleApiError(error, { cors: true });
  }
};
