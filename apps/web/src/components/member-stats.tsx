import { MemberAccess } from "@/components/member-access";
import { TravelerAccount } from "@/components/traveler-account";
import { ROLE } from "@/lib/labels";

/**
 * Kto ma dostęp i czy korzysta (tylko organizator): e-mail, rola, kiedy i z którego linku dołączył,
 * ostatnie logowanie, ostatnio na webie i w telefonie, zmiany w planie, przypisany uczestnik.
 * Pod spodem linki zaproszeń (użycia, ważność) i uczestnicy bez konta. Dane z `trip_member_stats`.
 */

export type MemberStat = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  can_add_expenses: boolean;
  joined_at: string;
  account_created_at: string | null;
  last_sign_in_at: string | null;
  last_seen_web_at: string | null;
  last_seen_phone_at: string | null;
  invite_id: string | null;
  changes: number;
  last_change_at: string | null;
  travelers: string[];
};

export type InviteStat = { id: string; role: string; created_at: string; expires_at: string; used_count: number; max_uses: number; revoked_at: string | null };
type Traveler = { id: string; name: string };

const date = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" });

/** „dziś 14:05”, „wczoraj”, „3 dni temu”, „12 lis 2026”. */
export function ago(iso: string | null, now: number): string {
  if (iso === null) return "nigdy";
  const at = new Date(iso);
  const days = Math.floor((now - at.getTime()) / 86_400_000);
  if (days <= 0) return `dziś ${at.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}`;
  if (days === 1) return "wczoraj";
  if (days < 7) return `${days} dni temu`;
  return date(iso);
}

export function MemberStats({ tripId, members, invites, travelers, editing, now }: { tripId: string; members: MemberStat[]; invites: InviteStat[]; travelers: Traveler[]; editing: boolean; now: number }) {
  const inviteOf = new Map(invites.map((invite) => [invite.id, invite]));
  const linked = new Set(members.flatMap((member) => member.travelers));
  const without = travelers.filter((each) => !linked.has(each.id));
  const active = members.filter((member) => member.last_seen_phone_at !== null || member.last_seen_web_at !== null).length;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-zinc-600 dark:text-zinc-400">
        Kont z dostępem: <strong>{members.length}</strong> · otwierało wyjazd: <strong>{active}</strong> · w telefonie:{" "}
        <strong>{members.filter((member) => member.last_seen_phone_at !== null).length}</strong> · uczestnicy z kontem:{" "}
        <strong>
          {travelers.length - without.length} z {travelers.length}
        </strong>
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead className="text-xs text-zinc-500">
            <tr>
              <th className="py-1 pr-3 font-normal">Konto</th>
              <th className="py-1 pr-3 font-normal">Dostęp</th>
              <th className="py-1 pr-3 font-normal">Dołączył(a)</th>
              <th className="py-1 pr-3 font-normal">Ostatnio</th>
              <th className="py-1 pr-3 font-normal">Zmiany w planie</th>
              <th className="py-1 font-normal">Uczestnik</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const invite = member.invite_id === null ? undefined : inviteOf.get(member.invite_id);
              return (
                <tr key={member.user_id} className="border-t border-zinc-200 align-top dark:border-zinc-800">
                  <td className="py-1.5 pr-3">
                    <span className="font-medium">{member.display_name ?? "?"}</span>
                    {member.email && <span className="block text-xs text-zinc-500">{member.email}</span>}
                  </td>
                  <td className="py-1.5 pr-3">
                    {editing && (member.role === "editor" || member.role === "viewer") ? (
                      <MemberAccess tripId={tripId} userId={member.user_id} name={member.display_name ?? member.email ?? "?"} role={member.role} canAddExpenses={member.can_add_expenses} />
                    ) : (
                      <>
                        {ROLE[member.role] ?? member.role}
                        {member.can_add_expenses && member.role === "viewer" && <span className="block text-xs text-zinc-500">+ dodaje wydatki</span>}
                      </>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    {date(member.joined_at)}
                    <span className="block text-xs text-zinc-500">
                      {member.role === "owner" ? "założył(a) wyjazd" : invite ? `z linku z ${date(invite.created_at)}` : "z zaproszenia"}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className="block">📱 {ago(member.last_seen_phone_at, now)}</span>
                    <span className="block">💻 {ago(member.last_seen_web_at, now)}</span>
                    <span className="block text-xs text-zinc-500">logowanie: {ago(member.last_sign_in_at, now)}</span>
                  </td>
                  <td className="py-1.5 pr-3">
                    {member.changes}
                    {member.last_change_at && <span className="block text-xs text-zinc-500">ostatnia: {ago(member.last_change_at, now)}</span>}
                  </td>
                  <td className="py-1.5">
                    {editing ? (
                      <TravelerAccount tripId={tripId} userId={member.user_id} travelers={travelers} current={member.travelers[0] ?? null} />
                    ) : (
                      (travelers.find((each) => each.id === member.travelers[0])?.name ?? <span className="text-zinc-500">—</span>)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!editing && members.length > 1 && <p className="text-xs text-zinc-500">Zmiana dostępu (widz ↔ edytor, wydatki, odebranie) i przypisanie konta do uczestnika — po „Edytuj”.</p>}

      {without.length > 0 && (
        <p className="text-zinc-600 dark:text-zinc-400">
          Bez konta (albo nieprzypisani): {without.map((each) => each.name).join(", ")}
        </p>
      )}

      {invites.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="font-medium">Linki zaproszeń</h3>
          <ul className="flex flex-col gap-0.5">
            {invites.map((invite) => {
              const joined = members.filter((member) => member.invite_id === invite.id);
              const state = invite.revoked_at ? "cofnięty" : new Date(invite.expires_at).getTime() < now ? "wygasł" : invite.used_count >= invite.max_uses ? "wykorzystany" : `ważny do ${date(invite.expires_at)}`;
              return (
                <li key={invite.id}>
                  {date(invite.created_at)} · {ROLE[invite.role] ?? invite.role} · użyty {invite.used_count} z {invite.max_uses} · <span className="text-zinc-500">{state}</span>
                  {joined.length > 0 && <span className="text-zinc-500"> · dołączyli: {joined.map((member) => member.display_name ?? member.email ?? "?").join(", ")}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
