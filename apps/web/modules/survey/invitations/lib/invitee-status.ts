import type { TInvitationRow } from "../types/invitation";

export type TInviteeStatus = "responded" | "sent" | "pending";
export type TInviteeFilter = "all" | TInviteeStatus;

// A response wins over a send: an invitee who answered is "responded" whatever else happened.
export const inviteeStatus = (row: Pick<TInvitationRow, "sentAt" | "respondedAt">): TInviteeStatus => {
  if (row.respondedAt) return "responded";
  if (row.sentAt) return "sent";
  return "pending";
};

export const countInviteeStatuses = (
  rows: Pick<TInvitationRow, "sentAt" | "respondedAt">[]
): Record<TInviteeFilter, number> => {
  const counts: Record<TInviteeFilter, number> = { all: rows.length, responded: 0, sent: 0, pending: 0 };
  for (const row of rows) counts[inviteeStatus(row)]++;
  return counts;
};

export const filterInvitees = <T extends Pick<TInvitationRow, "sentAt" | "respondedAt">>(
  rows: T[],
  filter: TInviteeFilter
): T[] => (filter === "all" ? rows : rows.filter((row) => inviteeStatus(row) === filter));
