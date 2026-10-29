import { ResourceNotFoundError } from "@formbricks/types/errors";
import { getPublicDomain } from "@/lib/getPublicUrl";
<<<<<<< HEAD:apps/web/app/(app)/workspaces/[workspaceId]/surveys/[surveyId]/(analysis)/summary/lib/emailTemplate.tsx
import { toJsWorkspaceStateSurvey } from "@/lib/survey/client-utils";
=======
import { getProjectByEnvironmentId } from "@/lib/project/service";
import { toJsEnvironmentStateSurvey } from "@/lib/survey/client-utils";
>>>>>>> origin/main:apps/web/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/lib/emailTemplate.tsx
import { getSurvey } from "@/lib/survey/service";
import { getStyling } from "@/lib/utils/styling";
import { getWorkspace } from "@/lib/workspace/service";
import { getTranslate } from "@/lingodotdev/server";
import { getPreviewEmailTemplateHtml } from "@/modules/email/components/preview-email-template";
import { extractEmailBodyFragment } from "./emailTemplateFragment";

export const getEmailTemplateHtml = async (surveyId: string, locale: string) => {
  const t = await getTranslate();
  const survey = await getSurvey(surveyId);
  if (!survey) {
    throw new ResourceNotFoundError(t("common.survey"), surveyId);
  }
  const workspace = await getWorkspace(survey.workspaceId);
  if (!workspace) {
    throw new ResourceNotFoundError(t("common.workspace"), null);
  }

<<<<<<< HEAD:apps/web/app/(app)/workspaces/[workspaceId]/surveys/[surveyId]/(analysis)/summary/lib/emailTemplate.tsx
  const styling = getStyling(workspace, toJsWorkspaceStateSurvey(survey));
=======
  const styling = getStyling(project, toJsEnvironmentStateSurvey(survey));
>>>>>>> origin/main:apps/web/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/lib/emailTemplate.tsx
  const surveyUrl = getPublicDomain() + "/s/" + survey.id;
  const html = await getPreviewEmailTemplateHtml(survey, surveyUrl, styling, locale, t);

  return extractEmailBodyFragment(html.toString());
};
