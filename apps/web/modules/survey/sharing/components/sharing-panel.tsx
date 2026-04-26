"use client";

import { useAutoAnimate } from "@formkit/auto-animate/react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CheckIcon, UsersIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  addSurveyAccessAction,
  getSurveySharingStateAction,
  removeSurveyAccessAction,
  setSurveyVisibilityAction,
} from "@/modules/survey/sharing/actions";
import { Button } from "@/modules/ui/components/button";
import { Label } from "@/modules/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@/modules/ui/components/radio-group";

type Member = { id: string; name: string; email: string };

interface SharingPanelProps {
  surveyId: string;
}

export const SharingPanel = ({ surveyId }: SharingPanelProps) => {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [access, setAccess] = useState<Member[]>([]);
  const [orgMembers, setOrgMembers] = useState<Member[]>([]);
  const [pendingPick, setPendingPick] = useState<string>("");
  const [parent] = useAutoAnimate();

  const reload = async () => {
    const res = await getSurveySharingStateAction({ surveyId });
    if (res?.data) {
      setVisibility(res.data.visibility as "private" | "public");
      setAccess(res.data.access);
      setOrgMembers(res.data.orgMembers);
      setLoaded(true);
    } else if (res?.serverError || res?.validationErrors) {
      toast.error("Failed to load sharing settings");
    }
  };

  useEffect(() => {
    if (open && !loaded) {
      void reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const accessIds = useMemo(() => new Set(access.map((m) => m.id)), [access]);
  const candidates = useMemo(() => orgMembers.filter((m) => !accessIds.has(m.id)), [orgMembers, accessIds]);

  const onVisibilityChange = async (next: "private" | "public") => {
    const prev = visibility;
    setVisibility(next);
    const res = await setSurveyVisibilityAction({ surveyId, visibility: next });
    if (res?.data) {
      toast.success(`Visibility set to ${next}`);
    } else {
      setVisibility(prev);
      toast.error("Failed to update visibility");
    }
  };

  const onAddUser = async () => {
    if (!pendingPick) return;
    const member = orgMembers.find((m) => m.id === pendingPick);
    if (!member) return;
    const res = await addSurveyAccessAction({ surveyId, userIds: [pendingPick] });
    if (res?.data) {
      setAccess([...access, member]);
      setPendingPick("");
    } else {
      toast.error("Failed to add user");
    }
  };

  const onRemoveUser = async (userId: string) => {
    const prev = access;
    setAccess(access.filter((u) => u.id !== userId));
    const res = await removeSurveyAccessAction({ surveyId, userId });
    if (!res?.data) {
      setAccess(prev);
      toast.error("Failed to remove user");
    }
  };

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className="w-full space-y-2 rounded-lg border border-slate-300 bg-white">
      <Collapsible.CollapsibleTrigger asChild className="h-full w-full cursor-pointer hover:bg-slate-50">
        <div className="inline-flex p-4">
          <div className="flex items-center pr-5 pl-2">
            <CheckIcon className="h-8 w-8 rounded-full border border-green-300 bg-green-100 p-1 text-green-600" />
          </div>
          <div>
            <p className="font-semibold text-slate-800">Sharing</p>
            <p className="mt-1 text-sm text-slate-500">
              Control who in this organization can see and edit this survey
            </p>
          </div>
        </div>
      </Collapsible.CollapsibleTrigger>
      <Collapsible.CollapsibleContent className="flex flex-col">
        <hr className="py-1 text-slate-600" />
        <div className="p-4 pl-6">
          <RadioGroup
            value={visibility}
            onValueChange={(v) => void onVisibilityChange(v as "private" | "public")}
            className="space-y-2">
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="private" id={`${surveyId}-private`} className="mt-1" />
              <div>
                <Label htmlFor={`${surveyId}-private`} className="font-medium">
                  Private
                </Label>
                <p className="text-sm text-slate-500">
                  Only the creator, survey admins, and people you list below can see this survey.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="public" id={`${surveyId}-public`} className="mt-1" />
              <div>
                <Label htmlFor={`${surveyId}-public`} className="font-medium">
                  Public
                </Label>
                <p className="text-sm text-slate-500">Everyone in this organization can see this survey.</p>
              </div>
            </div>
          </RadioGroup>

          {visibility === "private" && (
            <div className="mt-6">
              <p className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                <UsersIcon className="h-4 w-4" /> People with access
              </p>
              {!loaded ? (
                <p className="text-sm text-slate-400">Loading…</p>
              ) : (
                <>
                  <ul ref={parent} className="mb-3 space-y-1">
                    {access.length === 0 ? (
                      <li className="text-sm text-slate-400">
                        No additional users — only creator and admins.
                      </li>
                    ) : (
                      access.map((u) => (
                        <li
                          key={u.id}
                          className="flex items-center justify-between rounded border border-slate-200 px-3 py-1.5 text-sm">
                          <span>
                            <span className="font-medium">{u.name}</span>{" "}
                            <span className="text-slate-500">({u.email})</span>
                          </span>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void onRemoveUser(u.id)}
                            aria-label={`Remove ${u.name}`}>
                            <XIcon className="h-4 w-4" />
                          </Button>
                        </li>
                      ))
                    )}
                  </ul>
                  <div className="flex gap-2">
                    <select
                      className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                      value={pendingPick}
                      onChange={(e) => setPendingPick(e.target.value)}>
                      <option value="">— Add a user —</option>
                      {candidates.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.email})
                        </option>
                      ))}
                    </select>
                    <Button onClick={onAddUser} disabled={!pendingPick}>
                      Add
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </Collapsible.CollapsibleContent>
    </Collapsible.Root>
  );
};
