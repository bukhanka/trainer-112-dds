import { describe, expect, it } from "vitest";
import { selectServices } from "./engine";
import { loadJsonReference, readDataJson } from "./reference-json";
import {
  INCIDENT_KINDS,
  flagRowsForGroup,
  kindByName,
  resolveLeaf,
  resolveTree,
  rowOptions,
  signOptions,
  treeForKind,
  visibleRows,
  type LeafType,
} from "./tags";

const FLAME = "Открытое пламя / Дым";
const fire = INCIDENT_KINDS.trees.fire101;
const gas = INCIDENT_KINDS.trees.gas104;
const explosion = INCIDENT_KINDS.trees.explosion;
const leaves = readDataJson<{ types: LeafType[] }>("classifier.json").types;
const ref = loadJsonReference();
const nameOf = new Map(ref.services.map((s) => [s.id, s.shortName]));

describe("«Что случилось»", () => {
  it("has the customer's list with frequent buttons", () => {
    expect(INCIDENT_KINDS.kinds).toHaveLength(51);
    expect(kindByName("Справка-101")?.typeCodes).toEqual([23030000]);
    expect(kindByName("Отмена вызова")?.service).toBe(true);
    expect(INCIDENT_KINDS.frequent.default).toContain("104");
  });

  it("101, 104 and Взрыв open the hand-made panels", () => {
    expect(treeForKind(kindByName("101")!)?.id).toBe("fire101");
    expect(treeForKind(kindByName("104")!)?.id).toBe("gas104");
    expect(treeForKind(kindByName("Взрыв")!)?.id).toBe("explosion");
    expect(treeForKind(kindByName("ДТП")!)).toBeUndefined();
  });
});

describe("panel 101", () => {
  it("Улица · пламя · Нет доступа · Мусор → «пожар: мусор» and the screenshot services", () => {
    const r = resolveTree(fire, { where: "Улица", signStreet: FLAME, access: "Нет доступа", streetObject: "Мусор" });
    expect(r.typeCodes).toEqual([1010101]);
    expect(r.smokeTypeCodes).toEqual([1010102]);
    expect(r.flags).toEqual({ noAccess: true });
    const services = selectServices({ typeCodes: r.typeCodes, flags: r.flags }, ref).map((s) => nameOf.get(s.serviceId));
    expect(services).toEqual(["Служба 101", "ЦОДД", "ОАТИ"]);
  });

  it("rows appear step by step like on the screenshots", () => {
    const ids = (sel: Record<string, string>) => visibleRows(fire, sel).map((r) => r.id);
    expect(ids({ where: "Улица" })).toContain("signStreet");
    expect(ids({ where: "Улица" })).not.toContain("streetObject");
    expect(ids({ where: "Улица", signStreet: FLAME })).toContain("streetObject");
    expect(ids({ where: "Улица", signStreet: FLAME })).not.toContain("offense");
    expect(ids({ where: "Улица", signStreet: FLAME, streetObject: "Мусор" })).toContain("offense");
    expect(ids({ where: "Улица", signStreet: "Запах гари" })).not.toContain("threat");
  });

  it("yes/no rows set flags both ways", () => {
    const base = { where: "Улица", signStreet: FLAME, streetObject: "Мусор" };
    expect(resolveTree(fire, { ...base, threat: "Да", gas: "Нет данных" }).flags).toEqual({ threat: true, gas: false });
    expect(resolveTree(fire, { ...base, offense: "Есть правонарушение" }).flags).toEqual({ offense: true });
    expect(resolveTree(fire, { ...base, placeStreet: ["Тоннель"] }).flags).toEqual({ tunnel: true });
  });

  it("запах гари on the street is a leaf of its own", () => {
    expect(resolveTree(fire, { where: "Улица", signStreet: "Запах гари" }).typeCodes).toEqual([1011100]);
  });

  it("Дом · многоквартирный · квартира + колонка + подъезд → three leaves", () => {
    const r = resolveTree(fire, {
      where: "Дом",
      signHouse: FLAME,
      houseKind: "Дом многоквартирный",
      houseInner: ["Квартира", "Газовая колонка", "Подъезд"],
    });
    expect(r.typeCodes).toEqual([1050101, 1050301, 1050701]);
    expect(r.tags.map((t) => t.value)).toEqual(["Дом", FLAME, "Дом многоквартирный", "Квартира", "Газовая колонка", "Подъезд"]);
  });

  it("choices in hidden rows are ignored", () => {
    const r = resolveTree(fire, { where: "Улица", signStreet: FLAME, houseKind: "Дача", threat: "Да" });
    expect(r.typeCodes).toEqual([]);
    expect(r.complete).toBe(false);
  });

  it("Транспорт · Общественный транспорт → «пожар: автобус»", () => {
    const r = resolveTree(fire, { where: "Транспорт", signTransport: FLAME, access: "Нет доступа", transportObject: "Общественный транспорт" });
    expect(r.typeCodes).toEqual([1020101]);
  });

  it("school fire through «Здание / объект»", () => {
    const r = resolveTree(fire, { where: "Здание / объект", signObject: FLAME, buildingObject: "Учебное заведение" });
    expect(r.typeCodes).toEqual([1060101]);
  });
});

describe("signs panels (104, Взрыв)", () => {
  it("104: запах газа в частном доме", () => {
    const sel = { sign1: "Запах газа в помещении (в квартире, в доме)", sign2: "Дом частный" };
    expect(resolveTree(gas, sel).typeCodes).toEqual([13020300]);
  });

  it("104: the third sign narrows the flat", () => {
    const sel = { sign1: "Запах газа в помещении (в квартире, в доме)", sign2: "Квартира помещение", sign3: "Закрыто" };
    expect(resolveTree(gas, sel).typeCodes).toEqual([13020202]);
    const sign3 = gas.rows.find((r) => r.id === "sign3")!;
    expect(rowOptions(gas, sign3, sel).map((o) => o.value)).toEqual(["Открыто", "Закрыто", "После пожара", "Нежилое"]);
  });

  it("104: same label under different parents does not mix («Прочее»)", () => {
    const sign2 = gas.rows.find((r) => r.id === "sign2")!;
    const street = rowOptions(gas, sign2, { sign1: "Запах газа вне помещения (на улице)" });
    expect(street.map((o) => o.value)).toContain("Прочее");
    expect(resolveTree(gas, { sign1: "Запах газа вне помещения (на улице)", sign2: "Прочее" }).typeCodes).toEqual([13010700]);
  });

  it("Взрыв: «звуки похожие на взрыв» is a leaf on the first row", () => {
    const sel = { sign1: "Звуки похожие на взрыв, что взорвалось сообщить не может" };
    expect(resolveTree(explosion, sel).typeCodes).toEqual([3030000]);
  });
});

describe("generic panel by classifier signs", () => {
  it("first row of «Запах газа» lists the five signs", () => {
    expect(signOptions(leaves, 13, [])).toHaveLength(5);
  });

  it("a leaf ending at the chosen depth is picked", () => {
    expect(resolveLeaf(leaves, 13, ["Запах газа в помещении", "Дом частный"]).finalType).toBe("Запах бытового газа в частном доме");
  });

  it("fire without the third sign prefers open flame", () => {
    expect(resolveLeaf(leaves, 1, ["на улице", "мусор"]).typeCode).toBe(1010101);
  });

  it("an undecided choice returns candidates only", () => {
    const r = resolveLeaf(leaves, 13, ["Запах газа в помещении"]);
    expect(r.typeCode).toBeNull();
    expect(r.leaves.length).toBeGreaterThan(3);
  });

  it("subgroup narrows the kind «Скопление воды»", () => {
    const all = signOptions(leaves, 7, []);
    const water = signOptions(leaves, 7, [], "Скопление воды Подтопление Паводок");
    expect(water.length).toBeLessThan(all.length);
  });

  it("flag rows follow the routing conditions of the group", () => {
    const rows = flagRowsForGroup(20).map((r) => r.flag);
    expect(rows).toEqual(["victims", "refusedAmbulance", "noAccess", "offense"]);
  });
});
