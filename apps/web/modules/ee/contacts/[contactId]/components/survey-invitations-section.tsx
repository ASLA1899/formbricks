import Link from "next/link";
import { listInvitations } from "@/modules/survey/invitations/lib/invitations";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/modules/ui/components/table";

const formatDate = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

interface SurveyInvitationsSectionProps {
  environmentId: string;
  contactId: string;
}

// Server component — auth is enforced by `getEnvironmentAuth` on the page
// before this section ever loads. The DB query here is scoped to a single
// contactId, so listing all rows for that contact is the natural shape.
export const SurveyInvitationsSection = async ({
  environmentId,
  contactId,
}: SurveyInvitationsSectionProps) => {
  const rows = await listInvitations({ contactId });
  if (rows.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-slate-700">Survey invitations</h2>
      <div className="overflow-auto rounded-md border border-slate-200">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Survey</TableHead>
              <TableHead className="text-xs">Sent</TableHead>
              <TableHead className="text-xs">Responded</TableHead>
              <TableHead className="text-xs">Reminders</TableHead>
              <TableHead className="text-xs">Last reminder</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="py-2">
                  <Link
                    href={`/environments/${environmentId}/surveys/${row.surveyId}`}
                    className="font-medium text-slate-800 underline-offset-2 hover:underline">
                    {row.surveyName}
                  </Link>
                </TableCell>
                <TableCell className="py-2 text-xs text-slate-600">{formatDate(row.sentAt)}</TableCell>
                <TableCell className="py-2 text-xs text-slate-600">{formatDate(row.respondedAt)}</TableCell>
                <TableCell className="py-2 text-xs text-slate-600">{row.reminderCount}</TableCell>
                <TableCell className="py-2 text-xs text-slate-600">
                  {formatDate(row.lastReminderAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
