"use client";

import Link from "next/link";
import { dateParts, fmtLongDate, shortName } from "@/lib/dds/format";
import type { SeatInfo } from "@/lib/dds/seat";
import { useNow } from "./client";
import { Gear, Help, Monitor, Runner } from "./icons";

/** Dark block at the top right: date, place and a large clock with small seconds, as on the screenshots. */
export function ClockBlock({ seat, offset }: { seat: SeatInfo; offset: number }) {
  const now = useNow(offset);
  const p = now ? dateParts(now) : null;
  return (
    <div className="flex w-full shrink-0 items-start justify-between gap-3 bg-arm-dark px-3 py-3 text-white lg:w-[400px]">
      <div className="min-w-0 pt-1">
        <div className="text-[15px] font-bold whitespace-nowrap" suppressHydrationWarning>
          {now ? fmtLongDate(now) : " "}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-white/85">
          <span className="truncate" title={`${seat.serviceFull} · ${seat.studentName}`}>
            , {seat.serviceShort} · {shortName(seat.studentName)}
          </span>
          <Monitor className="h-3 w-3 shrink-0" />
          <Gear className="h-3 w-3 shrink-0" />
          <a
            href="/help#dds"
            target="_blank"
            rel="noopener"
            aria-label="Справка: памятка диспетчера"
            title="Справка: статусы, нормативы 30 секунд и 3 минуты, телефон — откроется в новой вкладке"
            className="hover:text-white"
          >
            <Help className="h-3 w-3 shrink-0" />
          </a>
          <Link href="/" title="Выйти с рабочего места в кабинет">
            <Runner className="h-3 w-3 shrink-0" />
          </Link>
        </div>
      </div>
      <div className="flex items-start font-bold leading-none" aria-label="Текущее время">
        <span className="text-[52px] tracking-wide tabular-nums">{p ? `${p.HH}:${p.MM}` : "--:--"}</span>
        <span className="ml-0.5 mt-0.5 text-[17px] tabular-nums">:{p ? p.SS : "--"}</span>
      </div>
    </div>
  );
}
