import { Heading, Hr, Text } from "@react-email/components";
import { EmailButton } from "../../src/components/email-button";
import { EmailFooter } from "../../src/components/email-footer";
import { EmailTemplate } from "../../src/components/email-template";
import { t as mockT } from "../../src/lib/mock-translate";
import { TEmailTemplateLegalProps } from "../../src/types/email";
import { TFunction } from "../../src/types/translations";

const emailFontStack = "'Retina', 'Calibri', 'Helvetica Neue', 'Helvetica', 'Arial', sans-serif";
const condensedFontStack =
  "'Retina Condensed', 'Retina', 'Calibri', 'Helvetica Neue', 'Helvetica', 'Arial', sans-serif";

export interface InvitationEmailProps extends TEmailTemplateLegalProps {
  readonly subject: string;
  readonly body: string;
  readonly surveyLink: string;
  readonly buttonLabel?: string;
  readonly heading?: string;
  readonly logoUrl?: string;
  readonly t?: TFunction;
}

export function InvitationEmail({
  body,
  surveyLink,
  buttonLabel,
  heading,
  logoUrl,
  t = mockT,
  ...legalProps
}: InvitationEmailProps): React.JSX.Element {
  return (
    <EmailTemplate logoUrl={logoUrl} t={t} {...legalProps}>
      <Text
        style={{
          fontFamily: condensedFontStack,
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: "#81BC00",
          margin: "0 0 12px",
        }}>
        {t("emails.invitation_eyebrow")}
      </Text>
      <Heading
        as="h1"
        style={{
          fontFamily: emailFontStack,
          fontSize: "26px",
          fontWeight: 700,
          letterSpacing: "-0.01em",
          lineHeight: 1.2,
          color: "#1A1A1A",
          margin: "0 0 16px",
        }}>
        {heading?.trim() || t("emails.invitation_heading")}
      </Heading>
      {/* Body is plain text with merge fields already substituted. Preserve newlines
          via CSS so we don't need to inject HTML (avoids XSS surface). */}
      <Text
        style={{
          fontFamily: emailFontStack,
          fontSize: "14px",
          lineHeight: 1.6,
          color: "#333333",
          margin: "0 0 20px",
          whiteSpace: "pre-wrap",
        }}>
        {body}
      </Text>
      <EmailButton href={surveyLink} label={buttonLabel ?? t("emails.invitation_button_label")} />
      <Hr style={{ borderColor: "#E9E4DA", margin: "24px 0 16px" }} />
      <Text
        style={{
          fontFamily: emailFontStack,
          fontSize: "12px",
          lineHeight: 1.55,
          color: "#888888",
          margin: 0,
        }}>
        {t("emails.invitation_fallback_link")}
        <br />
        <a href={surveyLink} style={{ color: "#003A49", wordBreak: "break-all" }}>
          {surveyLink}
        </a>
      </Text>
      <EmailFooter t={t} />
    </EmailTemplate>
  );
}

export default function InvitationEmailPreview(): React.JSX.Element {
  return (
    <InvitationEmail
      subject="Please take our member satisfaction survey"
      body={"Hi Jane,\n\nWe’d love to hear from you. This short survey takes about 5 minutes.\n\nThank you!"}
      surveyLink="https://surveys.example.com/c/abc123"
      buttonLabel="Take the survey"
    />
  );
}
