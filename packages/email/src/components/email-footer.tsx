import { Text } from "@react-email/components";
import { TFunction } from "../types/translations";

const emailFontStack = "'Retina', 'Calibri', 'Helvetica Neue', 'Helvetica', 'Arial', sans-serif";

export function EmailFooter({ t }: { t: TFunction }): React.JSX.Element {
  return (
    <Text
      style={{
        fontFamily: emailFontStack,
        fontSize: "14px",
        lineHeight: 1.6,
        color: "#333333",
        margin: "24px 0 0",
      }}>
      {t("emails.email_footer_text_1")}
      <br />
      {t("emails.email_footer_text_2")}
    </Text>
  );
}

export default EmailFooter;
