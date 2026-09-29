/**
 * Who sits where in the demo lessons (prisma/seed-demo.ts): the role of each student, the service of a ДДС place and the
 * tasks the teacher dealt. A ДДС place plays a district ДДС whose territory its cards are on — a city district gets
 * fires in high houses, a settlement of villages the low houses and its own private sector (dds/territory.ts); the test
 * tests/demo-plan.test.ts keeps it so. An empty task list in an adaptive lesson means `cards` tasks by the level.
 */
export type SeatPlan = { login: string; role: "OP112" | "DDS"; service?: string; tasks: string[]; cards?: number };

/** The service of a ДДС place the plan does not name. */
export const DEFAULT_DDS = "Поселение Вороновское";

export const DEMO_PLANS: Record<string, SeatPlan[]> = {
  "demo-lesson-h1": [
    { login: "student1", role: "OP112", tasks: ["Б31-3", "Б22-1"] },
    { login: "student2", role: "DDS", service: "Поселение Хорошево-Мневники", tasks: ["Б2-1", "Б17-1"] },
    { login: "student3", role: "OP112", tasks: ["Б20-1", "Б17-1"] },
    { login: "student4", role: "DDS", service: "Поселение Мещанский", tasks: ["Б17-1", "Б4-1"] },
    { login: "student5", role: "DDS", service: "Поселение Вороновское", tasks: ["Б30-3", "Б31-3"] },
  ],
  "demo-lesson-h2": [
    { login: "student1", role: "DDS", service: "Поселение Северное Бутово", tasks: ["Б4-1", "Б17-1"] },
    { login: "student2", role: "OP112", tasks: ["Б2-1", "Б17-1"] },
    { login: "student3", role: "DDS", service: "Поселение Хорошево-Мневники", tasks: ["Б2-1", "Б5-1"] },
    { login: "student4", role: "OP112", tasks: ["Б29-1", "Б31-3"] },
    { login: "student5", role: "OP112", tasks: ["Б20-1", "Б4-1"] },
  ],
  "demo-lesson-h3": [
    { login: "student1", role: "OP112", tasks: [], cards: 3 },
    { login: "student2", role: "DDS", service: "Поселение Черемушки", tasks: [], cards: 3 },
    { login: "student3", role: "DDS", service: "Поселение Хорошево-Мневники", tasks: [], cards: 3 },
    { login: "student4", role: "OP112", tasks: [], cards: 3 },
    { login: "student5", role: "DDS", service: "Поселение Мещанский", tasks: [], cards: 3 },
  ],
  "demo-lesson-h4": [
    { login: "student1", role: "DDS", service: "Поселение Вороновское", tasks: ["Б17-1"] },
    { login: "student2", role: "DDS", service: "Поселение Хорошево-Мневники", tasks: ["Б4-1", "Б5-1"] },
    { login: "student3", role: "OP112", tasks: ["Б30-3", "Б22-1"] },
    { login: "student4", role: "DDS", service: "Поселение Дорогомилово", tasks: ["Б1-1"] },
    { login: "student5", role: "OP112", tasks: ["Б2-1", "Б31-3"] },
  ],
  "demo-lesson-1": [
    { login: "student1", role: "OP112", tasks: ["Б30-3", "Б2-1"] },
    { login: "student2", role: "DDS", service: "Поселение Мещанский", tasks: ["Б17-1", "Б5-1", "Б2-1"] },
    { login: "student3", role: "DDS", service: "Поселение Северное Бутово", tasks: ["Б4-1", "Б17-1", "Б2-1"] },
    { login: "student4", role: "DDS", service: "Поселение Красносельский", tasks: ["Б28-3"] },
    { login: "student5", role: "OP112", tasks: ["Б17-1", "Б29-1"] },
  ],
  "demo-lesson-2": [
    { login: "student1", role: "DDS", service: "Поселение Вороновское", tasks: ["Б17-1", "Б31-3"] },
    { login: "student2", role: "OP112", tasks: ["Б30-3", "Б4-1"] },
    { login: "student3", role: "OP112", tasks: ["Б2-1", "Б29-1"] },
    { login: "student4", role: "DDS", service: "Поселение Хорошево-Мневники", tasks: ["Б5-1"] },
    { login: "student5", role: "DDS", service: "Поселение Северное Бутово", tasks: ["Б5-1-ош"] },
  ],
};
