import jwt from "jsonwebtoken";
import { logger } from "@formbricks/logger";
import { Result, err, ok } from "@formbricks/types/error-handlers";
import { ENCRYPTION_KEY } from "@/lib/constants";
import { symmetricDecrypt, symmetricEncrypt } from "@/lib/crypto";
import { getPublicDomain } from "@/lib/getPublicUrl";
import { generateSurveySingleUseId } from "@/lib/utils/single-use-surveys";
import { ApiErrorResponseV2 } from "@/modules/api/v2/types/api-error";
import { getSurvey } from "@/modules/survey/lib/survey";

/**
 * Personalized contact survey links (`/c/<token>`).
 *
 * ASLA fork: an independent re-implementation of the personalized-link helpers
 * that lets the invitation feature run without depending on the Formbricks
 * Enterprise Edition module (apps/web/modules/ee/**), whose license forbids
 * production use without a paid subscription. The token is a plain HS256 JWT
 * over the symmetrically-encrypted contact and survey ids and the link itself
 * never touches the Contact table.
 */

const JWT_ALGORITHM = "HS256" as const;

interface ContactSurveyTokenClaims {
  contactId: string;
  surveyId: string;
}

// Builds an encrypted, optionally expiring `/c/<token>` link for a contact.
export const getContactSurveyLink = async (
  contactId: string,
  surveyId: string,
  expirationDays?: number
): Promise<Result<string, ApiErrorResponseV2>> => {
  if (!ENCRYPTION_KEY) {
    return err({
      type: "internal_server_error",
      message: "Encryption key not found - cannot create personalized survey link",
    });
  }

  const survey = await getSurvey(surveyId);
  if (!survey) {
    return err({
      type: "not_found",
      message: "Survey not found",
      details: [{ field: "surveyId", issue: "not_found" }],
    });
  }

  const claims: ContactSurveyTokenClaims = {
    contactId: symmetricEncrypt(contactId, ENCRYPTION_KEY),
    surveyId: symmetricEncrypt(surveyId, ENCRYPTION_KEY),
  };

  const signOptions: jwt.SignOptions = { algorithm: JWT_ALGORITHM };
  if (expirationDays !== undefined && expirationDays > 0) {
    signOptions.expiresIn = `${expirationDays}d`;
  }

  const token = jwt.sign(claims, ENCRYPTION_KEY, signOptions);
  const link = `${getPublicDomain()}/c/${token}`;

  // Single-use surveys append a one-time id the survey runtime consumes.
  if (survey.singleUse?.enabled) {
    const singleUseId = generateSurveySingleUseId(survey.singleUse.isEncrypted ?? false);
    return ok(`${link}?suId=${singleUseId}`);
  }

  return ok(link);
};

// Verifies a `/c/<token>` JWT and returns the decrypted contact and survey ids.
export const verifyContactSurveyToken = (
  token: string
): Result<{ contactId: string; surveyId: string }, ApiErrorResponseV2> => {
  if (!ENCRYPTION_KEY) {
    return err({
      type: "internal_server_error",
      message: "Encryption key not found - cannot verify survey token",
    });
  }

  try {
    // Pin the algorithm to HS256: the secret is symmetric, so leaving this
    // open would let jsonwebtoken accept any of its HS* defaults.
    const claims = jwt.verify(token, ENCRYPTION_KEY, {
      algorithms: [JWT_ALGORITHM],
    }) as Partial<ContactSurveyTokenClaims>;

    if (!claims?.contactId || !claims?.surveyId) {
      // Surfaced as an invalid token by the catch block below.
      throw new Error("Contact survey token is missing required claims");
    }

    return ok({
      contactId: symmetricDecrypt(claims.contactId, ENCRYPTION_KEY),
      surveyId: symmetricDecrypt(claims.surveyId, ENCRYPTION_KEY),
    });
  } catch (error) {
    logger.error(error, "Error verifying contact survey token");

    if (error instanceof jwt.TokenExpiredError) {
      return err({
        type: "bad_request",
        message: "Survey link has expired",
        details: [{ field: "token", issue: "token_expired" }],
      });
    }

    return err({
      type: "bad_request",
      message: "Invalid survey token",
      details: [{ field: "token", issue: "invalid_token" }],
    });
  }
};
