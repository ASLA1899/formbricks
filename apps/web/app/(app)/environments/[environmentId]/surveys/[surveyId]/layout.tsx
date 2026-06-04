import { getServerSession } from "next-auth";
import { notFound } from "next/navigation";
import { prisma } from "@formbricks/database";
import { ResourceNotFoundError } from "@formbricks/types/errors";
import { canAccessSurvey, getSurveyAccessMembership } from "@/lib/survey/access";
import { getSurvey } from "@/lib/survey/service";
import { getTranslate } from "@/lingodotdev/server";
import { authOptions } from "@/modules/auth/lib/authOptions";
import { SurveyContextWrapper } from "./context/survey-context";

interface SurveyLayoutProps {
  params: Promise<{ surveyId: string; environmentId: string }>;
  children: React.ReactNode;
}

const SurveyLayout = async ({ params, children }: SurveyLayoutProps) => {
  const resolvedParams = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) notFound();

  const surveyAcl = await prisma.survey.findUnique({
    where: { id: resolvedParams.surveyId },
    select: {
      id: true,
      visibility: true,
      createdBy: true,
      surveyAccess: { select: { userId: true } },
      environment: { select: { project: { select: { organizationId: true } } } },
    },
  });
  if (!surveyAcl) notFound();

  const organizationId = surveyAcl.environment.project.organizationId;
  const membership = await getSurveyAccessMembership(session.user.id, organizationId);

  if (!canAccessSurvey({ userId: session.user.id, survey: surveyAcl, membership })) {
    notFound();
  }

  const survey = await getSurvey(resolvedParams.surveyId);
  const t = await getTranslate();

  if (!survey) {
    throw new ResourceNotFoundError(t("common.survey"), resolvedParams.surveyId);
  }

  return <SurveyContextWrapper survey={survey}>{children}</SurveyContextWrapper>;
};

export default SurveyLayout;
