import { Column, Hr, Row, Text } from "@react-email/components";
import { EmailButton } from "../../src/components/email-button";
import { EmailTemplate } from "../../src/components/email-template";
import { renderEmailResponseValue } from "../../src/lib/email-utils";
import { exampleData } from "../../src/lib/example-data";
import { t as mockT } from "../../src/lib/mock-translate";
import { TEmailTemplateLegalProps } from "../../src/types/email";
import { ProcessedHiddenField, ProcessedResponseElement, ProcessedVariable } from "../../src/types/follow-up";
import { TFunction } from "../../src/types/translations";

export interface FollowUpEmailProps extends TEmailTemplateLegalProps {
  readonly body: string; // Already processed HTML with recall tags replaced
  readonly responseData?: ProcessedResponseElement[]; // Already mapped elements
  readonly variables?: ProcessedVariable[]; // Already filtered variables
  readonly hiddenFields?: ProcessedHiddenField[]; // Already filtered hidden fields
  readonly fileLink?: { url: string; fileName: string }; // Tracked download link for the attached file
  readonly logoUrl?: string;
  readonly t?: TFunction;
}

export function FollowUpEmail({
  body,
  responseData = [],
  variables = [],
  hiddenFields = [],
  fileLink,
  logoUrl,
  t = mockT,
  ...legalProps
}: FollowUpEmailProps): React.JSX.Element {
  return (
    <EmailTemplate logoUrl={logoUrl} t={t} {...legalProps}>
      <>
        <div dangerouslySetInnerHTML={{ __html: body }} />

        {fileLink ? (
          <Row>
            <Column className="w-full">
              <Text className="mb-3 text-sm text-slate-700">{fileLink.fileName}</Text>
              <EmailButton label={t("emails.follow_up_file_download")} href={fileLink.url} />
            </Column>
          </Row>
        ) : null}

        {responseData.length > 0 ? (
          <>
            <Hr />
            <Text className="mb-4 text-base font-semibold text-slate-900">{t("emails.response_data")}</Text>
          </>
        ) : null}

        {responseData.map((e) => {
          if (!e.response) return null;
          return (
            <Row key={e.element}>
              <Column className="w-full">
                <Text className="mb-2 text-sm font-semibold text-slate-900">{e.element}</Text>
                {renderEmailResponseValue(e.response, e.type, t, true)}
              </Column>
            </Row>
          );
        })}

        {variables.map((variable) => (
          <Row key={variable.id}>
            <Column className="w-full">
              <Text className="mb-2 text-sm font-semibold text-slate-900">
                {variable.type === "number"
                  ? `${t("emails.number_variable")}: ${variable.name}`
                  : `${t("emails.text_variable")}: ${variable.name}`}
              </Text>
              <Text className="mt-0 whitespace-pre-wrap break-words text-sm text-slate-700">
                {variable.value}
              </Text>
            </Column>
          </Row>
        ))}

        {hiddenFields.map((hiddenField) => (
          <Row key={hiddenField.id}>
            <Column className="w-full">
              <Text className="mb-2 text-sm font-semibold text-slate-900">
                {t("emails.hidden_field")}: {hiddenField.id}
              </Text>
              <Text className="mt-0 whitespace-pre-wrap break-words text-sm text-slate-700">
                {hiddenField.value}
              </Text>
            </Column>
          </Row>
        ))}
      </>
    </EmailTemplate>
  );
}

export default function FollowUpEmailPreview(): React.JSX.Element {
  return <FollowUpEmail {...(exampleData.followUpEmail as unknown as FollowUpEmailProps)} />;
}
