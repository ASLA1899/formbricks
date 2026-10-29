import { Body, Column, Container, Head, Html, Img, Link, Row, Section, Tailwind, Text } from "react-email";
import { TEmailTemplateLegalProps } from "../types/email";
import { TFunction } from "../types/translations";

<<<<<<< HEAD
const fbLogoUrl = "https://app.formbricks.com/logo-transparent.png";
const logoLink = "https://formbricks.com?utm_source=formbricks-app&utm_medium=email&utm_campaign=email_logo";
const FORCE_LIGHT_COLOR_SCHEME = "only light";
/**
 * Widths are also emitted as `width` HTML attributes, in px, to match the `w-60` / `w-80` classes.
 * Tailwind compiles those classes to `rem`, and Outlook's Word rendering engine supports neither
 * `rem` nor `max-height` / `object-fit` — so without the attribute it constrains the logo not at
 * all and renders it at its natural size. An image wider than the email body cannot be centered,
 * which is why the width is part of fixing the centering rather than a separate concern.
 */
const DEFAULT_LOGO_WIDTH = 240; // w-60
const CUSTOM_LOGO_WIDTH = 320; // w-80
=======
const aslaWordmarkUrl = "https://surveys.asla.org/asla-logo-email.png";

const emailFontStack = "'Retina', 'Calibri', 'Helvetica Neue', 'Helvetica', 'Arial', sans-serif";
>>>>>>> origin/main

interface EmailTemplateProps extends TEmailTemplateLegalProps {
  readonly children: React.ReactNode;
  readonly forceLightMode?: boolean;
  readonly logoUrl?: string;
  readonly t: TFunction;
}

export function EmailTemplate({
  children,
  forceLightMode = false,
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
      {forceLightMode && (
        <Head>
          <meta name="color-scheme" content="only light" />
          <meta name="supported-color-schemes" content="light" />
          <style>
            {`:root {
  color-scheme: only light;
  supported-color-schemes: light;
}`}
          </style>
        </Head>
      )}
      <Tailwind>
        <Body
          className="m-0 h-full w-full p-0 text-sm"
          style={{
<<<<<<< HEAD
            ...(forceLightMode
              ? { backgroundColor: "#f8fafc", color: "#1e293b", colorScheme: FORCE_LIGHT_COLOR_SCHEME }
              : {}),
            fontFamily: "'Jost', 'Helvetica Neue', 'Segoe UI', 'Helvetica', 'sans-serif'",
          }}>
          {/* The logo is centered on the wrapping cell, not on the image itself: Outlook's Word
              rendering engine ignores `margin: auto`, so `mx-auto` alone left-aligns the logo
              there. `align="center"` is an HTML attribute Word does honor, and `Column` is the
              only react-email primitive that renders a `<td>` we can put it on (`Section` keeps
              its cell bare). `mx-auto` stays for clients that honor the image's own margins. */}
          <Row>
            <Column align="center" className="text-center">
              {isDefaultLogo ? (
                <Link href={logoLink} target="_blank">
                  <Img
                    data-testid="default-logo-image"
                    alt="Logo"
                    className="mx-auto w-60"
                    src={fbLogoUrl}
                    width={DEFAULT_LOGO_WIDTH}
                  />
                </Link>
              ) : (
                <Img
                  data-testid="logo-image"
                  alt="Logo"
                  className="mx-auto max-h-[100px] w-80 object-contain"
                  src={logoUrl}
                  width={CUSTOM_LOGO_WIDTH}
                />
              )}
            </Column>
          </Row>
          <Container className="mx-auto my-8 max-w-xl rounded-md bg-white p-4 text-start">
            {children}
          </Container>

          <Section className="mt-4 text-center text-sm">
            <Link
              className="m-0 text-sm font-normal text-slate-500"
              href="https://formbricks.com/?utm_source=formbricks-app&utm_medium=email&utm_campaign=email_footer_text"
              target="_blank"
              rel="noopener noreferrer">
              {t("emails.email_template_text_1")}
            </Link>
            {imprintAddress && (
              <Text className="m-0 text-sm font-normal text-slate-500 opacity-50">{imprintAddress}</Text>
            )}
            <Text className="m-0 text-sm font-normal text-slate-500 opacity-50">
              {imprintUrl && (
                <Link
                  href={imprintUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-slate-500">
                  {t("emails.imprint")}
                </Link>
=======
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
                  color: "#FFFFFF",
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
>>>>>>> origin/main
              )}
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export default EmailTemplate;
