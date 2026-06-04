import { ResourceNotFoundError } from "@formbricks/types/errors";
import {
  TDisplayCreateInputV2,
  ZDisplayCreateInputV2,
} from "@/app/api/v2/client/[environmentId]/displays/types/display";
import { reportApiError } from "@/app/lib/api/api-error-reporter";
import { parseAndValidateJsonBody } from "@/app/lib/api/parse-and-validate-json-body";
import { responses } from "@/app/lib/api/response";
import { createDisplay } from "./lib/display";

interface Context {
  params: Promise<{
    environmentId: string;
  }>;
}

type TValidatedDisplayInputResult = { displayInputData: TDisplayCreateInputV2 } | { response: Response };

const parseAndValidateDisplayInput = async (
  request: Request,
  environmentId: string
): Promise<TValidatedDisplayInputResult> => {
  const inputValidation = await parseAndValidateJsonBody({
    request,
    schema: ZDisplayCreateInputV2,
    buildInput: (jsonInput) => ({
      ...(jsonInput !== null && typeof jsonInput === "object" ? jsonInput : {}),
      environmentId,
    }),
    malformedJsonMessage: "Invalid JSON in request body",
  });

  if ("response" in inputValidation) {
    return inputValidation;
  }

  return { displayInputData: inputValidation.data };
};

export const OPTIONS = async (): Promise<Response> => {
  return responses.successResponse(
    {},
    true,
    // Cache CORS preflight responses for 1 hour (conservative approach)
    // Balances performance gains with flexibility for CORS policy changes
    "public, s-maxage=3600, max-age=3600"
  );
};

export const POST = async (request: Request, context: Context): Promise<Response> => {
  const params = await context.params;
  const validatedInput = await parseAndValidateDisplayInput(request, params.environmentId);

  if ("response" in validatedInput) {
    return validatedInput.response;
  }

  const { displayInputData } = validatedInput;

  // ASLA fork: allow contactId WITHOUT an EE Contacts license. Our /c/<jwt> invitation flow
  // creates a display with contactId so responses link to a valid displayId. Upstream gates
  // this behind EE Contacts (identical to the responses gate removed in 6f87f50c9); the 403 is
  // swallowed by the surveys SDK, silently dropping every invitation display. The gate is
  // intentionally omitted — contactId passes straight through to createDisplay.
  try {
    const response = await createDisplay(displayInputData);

    return responses.successResponse(response, true);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return responses.notFoundResponse("Survey", displayInputData.surveyId, true);
    }

    const response = responses.internalServerErrorResponse("Something went wrong. Please try again.", true);
    reportApiError({
      request,
      status: response.status,
      error,
    });
    return response;
  }
};
