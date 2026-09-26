import type { Metadata } from "next";
import { Workstation } from "./ui/Workstation";
import "./op112.css";

export const metadata: Metadata = { title: "Оператор 112 · Тренажёр" };

// Full-screen 112 operator workstation; access is checked by the layout and by every API route.
export default function Op112Page() {
  return <Workstation />;
}
