import { db } from "@/lib/db";
import { CreateUserForm, UserRowActions } from "./UserForms";

const ROLE = { ADMIN: "Администратор", TEACHER: "Преподаватель", STUDENT: "Обучающийся" } as const;

export default async function UsersPage() {
  const users = await db.user.findMany({ orderBy: [{ role: "asc" }, { login: "asc" }] });
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Пользователи</h1>
      <CreateUserForm />
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-arm-panel text-left text-xs text-arm-desc">
            <tr>
              <th className="p-2">Логин</th>
              <th className="p-2">ФИО</th>
              <th className="p-2">Роль</th>
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
                  <td className="p-2">
                    {u.isBlocked ? (
                      <span className="text-arm-late">заблокирован</span>
                    ) : locked ? (
                      <span className="text-arm-orange">временно закрыт после неудачных входов</span>
                    ) : (
                      "активен"
                    )}
                  </td>
                  <td className="p-2 text-xs">{u.lastLoginAt ? u.lastLoginAt.toLocaleString("ru-RU") : "—"}</td>
                  <td className="p-2">
                    <UserRowActions userId={u.id} blocked={u.isBlocked} />
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
