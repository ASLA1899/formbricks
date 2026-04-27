import { Body, Container, Html, Img, Link, Section, Tailwind, Text } from "@react-email/components";
import { TEmailTemplateLegalProps } from "../types/email";
import { TFunction } from "../types/translations";

const aslaWordmarkUrl = "https://surveys.asla.org/asla-logo-email.png";

const emailFontStack = "'Retina', 'Calibri', 'Helvetica Neue', 'Helvetica', 'Arial', sans-serif";

interface EmailTemplateProps extends TEmailTemplateLegalProps {
  readonly children: React.ReactNode;
  readonly logoUrl?: string;
  readonly t: TFunction;
}

export function EmailTemplate({
  children,
  logoUrl,
  t,
  privacyUrl,
  imprintUrl,
  imprintAddress,
}: EmailTemplateProps): React.JSX.Element {
  // Per ASLA email guide: web fonts unreliable in email — system cascade only.
  // Org-level custom logos still override the ASLA wordmark when configured.
  const mastheadLogo = logoUrl ?? aslaWordmarkUrl;
  const isCustomLogo = Boolean(logoUrl) && logoUrl !== aslaWordmarkUrl;

  return (
    <Html>
      <Tailwind>
        <Body
          className="m-0 h-full w-full p-0 text-sm"
          style={{
            backgroundColor: "#FBF8F1",
            fontFamily: emailFontStack,
            color: "#1A1A1A",
          }}>
          <Container
            className="mx-auto"
            style={{ maxWidth: "640px", width: "100%", backgroundColor: "#FFFFFF" }}>
            <Section
              style={{
                backgroundColor: "#003A49",
                padding: "24px 36px",
              }}>
              <Img
                data-testid={isCustomLogo ? "logo-image" : "default-logo-image"}
                alt={isCustomLogo ? "Logo" : "American Society of Landscape Architects"}
                src={mastheadLogo}
                width={isCustomLogo ? 260 : 220}
                height={isCustomLogo ? 60 : 56}
                style={{
                  display: "block",
                  border: 0,
                  outline: "none",
                  textDecoration: "none",
                  maxWidth: "100%",
                  height: "auto",
                }}
              />
            </Section>

            <Container style={{ padding: "32px 36px 8px", backgroundColor: "#FFFFFF" }}>{children}</Container>

            <Section
              style={{
                backgroundColor: "#1A1A1A",
                padding: "24px 36px 28px",
                color: "#FFFFFF",
              }}>
              <Link
                href="https://asla.org"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "#81BC00",
                  fontFamily: emailFontStack,
                  fontSize: "12px",
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textDecoration: "none",
                }}>
                {t("emails.email_template_text_1")}
              </Link>
              {imprintAddress ? (
                <Text
                  className="m-0"
                  style={{
                    color: "rgba(255,255,255,0.6)",
                    fontFamily: emailFontStack,
                    fontSize: "11px",
                    lineHeight: 1.6,
                    marginTop: "8px",
                  }}>
                  {imprintAddress}
                </Text>
              ) : null}
              {(imprintUrl || privacyUrl) && (
                <Text
                  className="m-0"
                  style={{
                    color: "rgba(255,255,255,0.6)",
                    fontFamily: emailFontStack,
                    fontSize: "11px",
                    lineHeight: 1.6,
                    marginTop: "6px",
                  }}>
                  {imprintUrl ? (
                    <Link
                      href={imprintUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#81BC00", textDecoration: "none", marginRight: "12px" }}>
                      {t("emails.imprint")}
                    </Link>
                  ) : null}
                  {privacyUrl ? (
                    <Link
                      href={privacyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#81BC00", textDecoration: "none" }}>
                      {t("emails.privacy_policy")}
                    </Link>
                  ) : null}
                </Text>
              )}
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export default EmailTemplate;
