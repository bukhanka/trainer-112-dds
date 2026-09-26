import { redirect } from "next/navigation";
import { currentUser, homeFor } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(homeFor(user.role));

  return (
    <main className="relative flex min-h-screen items-center justify-end overflow-hidden bg-gradient-to-br from-[#dcebf6] via-[#a9c8e0] to-[#6f98bb] px-4 sm:px-16">
      <CitySkyline />
      <section className="relative z-10 flex w-full max-w-sm flex-col items-center gap-6 bg-white/85 p-8 shadow-lg backdrop-blur-sm">
        <div className="text-center">
          <div className="text-7xl font-bold leading-none text-arm-dark">112</div>
          <div className="mt-2 text-lg font-semibold tracking-widest text-arm-dark">ВХОД В СИСТЕМУ</div>
          <div className="mt-1 text-xs text-arm-desc">Учебный тренажёр оператора 112 и диспетчера ДДС</div>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}

function CitySkyline() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute bottom-0 left-0 h-2/3 w-full text-[#5b84a6] opacity-60"
      viewBox="0 0 1200 400"
      preserveAspectRatio="none"
      fill="currentColor"
    >
      <path d="M0 400V250h60v-60h40v90h50V160h70v120h40V120h30V80h20v40h30v160h60V200h80v80h40V140h60v140h50V220h70v60h40V90h20V60h20v30h20v190h60V180h90v100h50V240h60v-80h70v240z" />
    </svg>
  );
}
