"use client";

import { createContext, useContext } from "react";

export type CrewOption = { crew: string; title: string; leader: string };

export type SoftphoneApi = {
  /** A call can be placed now (a place of a running lesson, no other call in progress). */
  canDial: boolean;
  /** Dial a number; with an incident the call is logged against that card. */
  dial: (number: string, opts?: { incidentId?: string }) => void;
  /** Crews of the place — suggestions for «Номер наряда». */
  crews: CrewOption[];
};

export const SoftphoneContext = createContext<SoftphoneApi>({ canDial: false, dial: () => {}, crews: [] });

export function useSoftphone(): SoftphoneApi {
  return useContext(SoftphoneContext);
}
