"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import { CheckIcon, UsersIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import {
  addSurveyAccessAction,
  getSurveySharingStateAction,
  removeSurveyAccessAction,
  setSurveyAccessModeAction,
} from "@/modules/survey/sharing/actions";
import { Button } from "@/modules/ui/components/button";
import { Label } from "@/modules/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@/modules/ui/components/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/ui/components/select";

type TMember = { id: string; name: string; email: string };
type TAccessMode = "private" | "public";

interface SharingPanelProps {
  surveyId: string;
}

/**
 * ASLA fork (ASL-1881): per-person sharing for a survey. Private = its owner, the organization's
 * owners and managers, and the people listed here (read only). Public = everyone in the organization.
 * Rendered only for people who may change visibility; the server actions check it again.
 */
export const SharingPanel = ({ surveyId }: Readonly<SharingPanelProps>) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [accessMode, setAccessMode] = useState<TAccessMode>("private");
  const [access, setAccess] = useState<TMember[]>([]);
  const [orgMembers, setOrgMembers] = useState<TMember[]>([]);
  const [pendingPick, setPendingPick] = useState("");

  const load = async () => {
    const result = await getSurveySharingStateAction({ surveyId });
    if (result?.data) {
      setAccessMode(result.data.accessMode);
      setAccess(result.data.access);
      setOrgMembers(result.data.orgMembers);
      setLoaded(true);
    } else {
      toast.error(t("workspace.surveys.edit.survey_sharing_load_failed"));
    }
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && !loaded) void load();
  };

  const accessIds = useMemo(() => new Set(access.map((member) => member.id)), [access]);
  const candidates = useMemo(
    () => orgMembers.filter((member) => !accessIds.has(member.id)),
    [orgMembers, accessIds]
  );

  const onAccessModeChange = async (next: TAccessMode) => {
    const previous = accessMode;
    setAccessMode(next);
    const result = await setSurveyAccessModeAction({ accessMode: next, surveyId });
    if (result?.data) {
      toast.success(t("workspace.surveys.edit.survey_sharing_mode_updated"));
    } else {
      setAccessMode(previous);
      toast.error(t("workspace.surveys.edit.survey_sharing_mode_failed"));
    }
  };

  const onAddUser = async () => {
    const member = orgMembers.find((candidate) => candidate.id === pendingPick);
    if (!member) return;
    const result = await addSurveyAccessAction({ surveyId, userIds: [member.id] });
    if (result?.data) {
      setAccess((current) => [...current, member]);
      setPendingPick("");
    } else {
      toast.error(t("workspace.surveys.edit.survey_sharing_add_failed"));
    }
  };

  const onRemoveUser = async (userId: string) => {
    const previous = access;
    setAccess((current) => current.filter((member) => member.id !== userId));
    const result = await removeSurveyAccessAction({ surveyId, userId });
    if (!result?.data) {
      setAccess(previous);
      toast.error(t("workspace.surveys.edit.survey_sharing_remove_failed"));
    }
  };

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={onOpenChange}
      className="w-full space-y-2 rounded-lg border border-slate-300 bg-white">
      <Collapsible.CollapsibleTrigger asChild className="h-full w-full cursor-pointer hover:bg-slate-50">
        <div className="inline-flex p-4">
          <div className="flex items-center pr-5 pl-2">
            <CheckIcon className="h-8 w-8 rounded-full border border-green-300 bg-green-100 p-1 text-green-600" />
          </div>
          <div>
            <p className="font-semibold text-slate-800">{t("workspace.surveys.edit.survey_sharing_title")}</p>
            <p className="mt-1 text-sm text-slate-500">
              {t("workspace.surveys.edit.survey_sharing_description")}
            </p>
          </div>
        </div>
      </Collapsible.CollapsibleTrigger>
      <Collapsible.CollapsibleContent className="flex flex-col">
        <hr className="py-1 text-slate-600" />
        <div className="p-4 pl-6">
          <RadioGroup
            value={accessMode}
            onValueChange={(value) => void onAccessModeChange(value as TAccessMode)}
            className="space-y-2">
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="private" id={`${surveyId}-private`} className="mt-1" />
              <div>
                <Label htmlFor={`${surveyId}-private`} className="font-medium">
                  {t("workspace.surveys.edit.survey_sharing_private")}
                </Label>
                <p className="text-sm text-slate-500">
                  {t("workspace.surveys.edit.survey_sharing_private_description")}
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="public" id={`${surveyId}-public`} className="mt-1" />
              <div>
                <Label htmlFor={`${surveyId}-public`} className="font-medium">
                  {t("workspace.surveys.edit.survey_sharing_public")}
                </Label>
                <p className="text-sm text-slate-500">
                  {t("workspace.surveys.edit.survey_sharing_public_description")}
                </p>
              </div>
            </div>
          </RadioGroup>

          {accessMode === "private" && (
            <div className="mt-6">
              <p className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                <UsersIcon className="h-4 w-4" />
                {t("workspace.surveys.edit.survey_sharing_people_with_access")}
              </p>
              {loaded ? (
                <>
                  <ul className="mb-3 space-y-1">
                    {access.length === 0 ? (
                      <li className="text-sm text-slate-400">
                        {t("workspace.surveys.edit.survey_sharing_nobody_else")}
                      </li>
                    ) : (
                      access.map((member) => (
                        <li
                          key={member.id}
                          className="flex items-center justify-between rounded border border-slate-200 px-3 py-1.5 text-sm">
                          <span>
                            <span className="font-medium">{member.name}</span>{" "}
                            <span className="text-slate-500">({member.email})</span>
                          </span>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void onRemoveUser(member.id)}
                            aria-label={t("workspace.surveys.edit.survey_sharing_remove_person", {
                              name: member.name,
                            })}>
                            <XIcon className="h-4 w-4" />
                          </Button>
                        </li>
                      ))
                    )}
                  </ul>
                  <div className="flex gap-2">
                    <Select value={pendingPick} onValueChange={setPendingPick}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={t("workspace.surveys.edit.survey_sharing_add_a_person")} />
                      </SelectTrigger>
                      <SelectContent>
                        {candidates.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.name} ({member.email})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={() => void onAddUser()} disabled={!pendingPick}>
                      {t("common.add")}
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {t("workspace.surveys.edit.survey_sharing_picker_hint")}
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-400">{t("common.loading")}</p>
              )}
            </div>
          )}
        </div>
      </Collapsible.CollapsibleContent>
    </Collapsible.Root>
  );
};
