import { useTranslation } from "react-i18next";
import { FB_PART } from "@formbricks/survey-ui/parts";

export function FormbricksBranding() {
  const { t } = useTranslation();
  const sourceCodeUrl =
    typeof window !== "undefined"
      ? (window as any).FORMBRICKS_SOURCE_CODE_URL || "https://github.com/ASLA1899/formbricks"
      : "https://github.com/ASLA1899/formbricks";

  return (
    <span className="flex flex-col items-center gap-1">
      <a
        data-fb-part={FB_PART.branding}
        href="https://formbricks.com?utm_source=formbricks-app&utm_medium=survey&utm_campaign=powered_by_badge"
        target="_blank"
        rel="noopener">
        <p className="text-signature text-xs">
          {t("common.powered_by")}{" "}
          <b>
            <span className="text-branding-text hover:text-signature">Formbricks</span>
          </b>
        </p>
      </a>
      <a
        href={sourceCodeUrl}
        target="_blank"
        tabIndex={-1}
        rel="noopener"
        className="text-signature text-xs hover:underline">
        Source Code (AGPL v3)
      </a>
    </span>
  );
}
