import { Metadata } from "next";
import { getServerSession } from "next-auth";
import { notFound } from "next/navigation";
import { prisma } from "@formbricks/database";
import { ResponseFilterProvider } from "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/components/response-filter-context";
import { getResponseCountBySurveyId } from "@/lib/response/service";
import { canAccessSurvey, getSurveyAccessMembership } from "@/lib/survey/access";
import { getSurvey } from "@/lib/survey/service";
import { authOptions } from "@/modules/auth/lib/authOptions";

type Props = {
  params: Promise<{ surveyId: string; environmentId: string }>;
  children: React.ReactNode;
};

export const generateMetadata = async (props: Props): Promise<Metadata> => {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  const survey = await getSurvey(params.surveyId);
  const responseCount = await getResponseCountBySurveyId(params.surveyId);

  if (session) {
    return {
      title: `${responseCount} Responses | ${survey?.name} Results`,
    };
  }
  return {
    title: "",
  };
};

const SurveyLayout = async ({ params, children }: Props) => {
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

  return <ResponseFilterProvider>{children}</ResponseFilterProvider>;
};

export default SurveyLayout;
