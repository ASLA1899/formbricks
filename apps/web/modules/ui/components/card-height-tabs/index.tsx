"use client";

import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TCardSize } from "@formbricks/types/styling";
import { StylingTabs } from "@/modules/ui/components/styling-tabs";

interface CardHeightTabsProps {
  activeCardSize: TCardSize;
  setActiveCardSize: (value: TCardSize) => void;
  disabled?: boolean;
}

export const CardHeightTabs = ({
  activeCardSize,
  setActiveCardSize,
  disabled = false,
}: Readonly<CardHeightTabsProps>) => {
  const { t } = useTranslation();

  const handleCardSizeChange = (cardSize: TCardSize) => {
    if (disabled) return;
    setActiveCardSize(cardSize);
  };

  const iconClassName = "size-4 text-slate-900";

  const options: {
    value: TCardSize;
    label: string;
    icon: ReactNode;
  }[] = [
    {
      value: "normal",
      label: t("workspace.surveys.edit.card_height_normal"),
      icon: <ChevronsDownUp className={iconClassName} />,
    },
    {
      value: "tall",
      label: t("workspace.surveys.edit.card_height_tall"),
      icon: <ChevronsUpDown className={iconClassName} />,
    },
  ];

  return (
    <div className="w-full gap-2 rounded-md bg-white">
      <StylingTabs
        id="card-height"
        onChange={(value) => {
          handleCardSizeChange(value);
        }}
        options={options}
        defaultSelected={activeCardSize}
        className="w-full"
        tabsContainerClassName="p-1 gap-2"
      />
    </div>
  );
};
