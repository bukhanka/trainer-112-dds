import { accessPolicy } from "@/lib/auth/policy";
import { isProtectedDemoLogin } from "@/lib/auth/demo";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateTime, shortName } from "@/lib/format";
import { CreateUserForm, UserRowActions } from "./UserForms";

const ROLE = { ADMIN: "Администратор", TEACHER: "Преподаватель", STUDENT: "Обучающийся" } as const;

export default async function UsersPage() {
  const admin = await requireUser(["ADMIN"]);
  const [users, groups, policy] = await Promise.all([
    db.user.findMany({
      orderBy: [{ role: "asc" }, { login: "asc" }],
      include: {
        memberships: { where: { group: { archivedAt: null } }, select: { group: { select: { name: true } } } },
        groupsTaught: { where: { archivedAt: null }, select: { name: true } },
      },
    }),
    db.group.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, teacher: { select: { fullName: true } } } }),
    accessPolicy(),
  ]);
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Пользователи</h1>
      <CreateUserForm
        groups={groups.map((g) => ({ id: g.id, name: g.name, teacher: g.teacher ? shortName(g.teacher.fullName) : null }))}
        minPasswordLength={policy.minPasswordLength}
      />
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-arm-panel text-left text-xs text-arm-desc">
            <tr>
              <th className="p-2">Логин</th>
              <th className="p-2">ФИО</th>
              <th className="p-2">Роль</th>
              <th className="p-2">Группы</th>
              <th className="p-2">Состояние</th>
              <th className="p-2">Последний вход</th>
              <th className="p-2">Действия</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const locked = u.lockedUntil && u.lockedUntil > now;
              return (
                <tr key={u.id} className="border-t align-top">
                  <td className="p-2 font-mono">{u.login}</td>
                  <td className="p-2">{u.fullName}</td>
                  <td className="p-2">{ROLE[u.role]}</td>
                  <td className="p-2 text-xs">
                    {u.role === "STUDENT" ? (
                      u.memberships.length ? (
                        u.memberships.map((m) => m.group.name).join(", ")
                      ) : (
                        <span className="text-arm-orange" title="Без группы ученик не попадёт на занятие">
                          без группы
                        </span>
                      )
                    ) : u.role === "TEACHER" && u.groupsTaught.length ? (
                      `ведёт: ${u.groupsTaught.map((g) => g.name).join(", ")}`
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-2">
                    {u.isBlocked ? (
                      <span className="text-arm-late">заблокирован</span>
                    ) : locked ? (
                      <span className="text-arm-orange">временно закрыт после неудачных входов</span>
                    ) : (
                      "активен"
                    )}
                  </td>
                  <td className="p-2 text-xs">{u.lastLoginAt ? formatDateTime(u.lastLoginAt, true) : "—"}</td>
                  <td className="p-2">
                    <UserRowActions userId={u.id} login={u.login} blocked={u.isBlocked} self={u.id === admin.id} demo={isProtectedDemoLogin(u.login)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
