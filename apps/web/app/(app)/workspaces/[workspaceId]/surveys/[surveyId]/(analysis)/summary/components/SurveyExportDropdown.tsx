"use client";

import { Download, FileImage, FileText, Globe, Loader2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { logger } from "@formbricks/logger";
import { type TSurvey } from "@formbricks/types/surveys/types";
import { Button } from "@/modules/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/modules/ui/components/dropdown-menu";
import { TooltipRenderer } from "@/modules/ui/components/tooltip";
import { type TSurveyExportFormat, runSurveyExport } from "../lib/survey-export/run-export";

interface SurveyExportDropdownProps {
  survey: TSurvey;
}

export const SurveyExportDropdown = ({ survey }: SurveyExportDropdownProps) => {
  const { t } = useTranslation();
  const [exportingFormat, setExportingFormat] = useState<TSurveyExportFormat | null>(null);

  const successMessages: Record<TSurveyExportFormat, string> = {
    html: t("workspace.surveys.survey_exported_as_html"),
    docx: t("workspace.surveys.survey_exported_as_docx"),
    pdf: t("workspace.surveys.print_dialog_opened"),
  };

  const handleExport = async (format: TSurveyExportFormat) => {
    setExportingFormat(format);
    try {
      await runSurveyExport(survey, format);
      toast.success(successMessages[format]);
    } catch (error) {
      logger.error(error, `Survey export as ${format} failed`);
      toast.error(t("workspace.surveys.export_failed"));
    } finally {
      setExportingFormat(null);
    }
  };

  const isExporting = exportingFormat !== null;

  return (
    <DropdownMenu>
      <TooltipRenderer tooltipContent={t("workspace.surveys.export_survey")}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("workspace.surveys.export_survey")}
            className="border border-slate-300 bg-white hover:bg-slate-50">
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
      </TooltipRenderer>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => handleExport("pdf")} disabled={isExporting}>
          <FileImage className="mr-2 h-4 w-4 text-red-500" />
          {t("workspace.surveys.print_as_pdf")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("docx")} disabled={isExporting}>
          <FileText className="mr-2 h-4 w-4 text-blue-500" />
          {t("workspace.surveys.export_as_docx")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("html")} disabled={isExporting}>
          <Globe className="mr-2 h-4 w-4 text-green-500" />
          {t("workspace.surveys.export_as_html")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
