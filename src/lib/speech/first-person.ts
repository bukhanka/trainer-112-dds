/**
 * A caller speaks about himself in the first person. The tickets are written about the caller by the author of the
 * ticket — «номер дома не знает», «пострадавших не видит», «Видит столб дыма», «заявитель на 7-м» — and a line read
 * off such a note sounds like a report about someone else. Before a caller says a ticket fact (and before the model
 * sees it), the note is turned to «не знаю», «не вижу», «Вижу столб дыма», «я на 7-м».
 *
 * Only the verbs of what the caller himself knows, sees and can do change, and only when nobody else is the subject of
 * the sentence: «Полиция здесь, открыть не может» and «дышит с трудом, говорить не может» are about another person
 * and stay as they are; a bare «может» («Может упасть на палатку») changes only after the caller is already the
 * subject («Проходит мимо, может подождать» → «Прохожу мимо, могу подождать»).
 */

/** 3rd person → 1st person of the verbs a ticket uses about the caller. */
const OWN: Record<string, string> = {
  знает: "знаю",
  видит: "вижу",
  помнит: "помню",
  слышит: "слышу",
  понимает: "понимаю",
  может: "могу",
  проходит: "прохожу",
  смотрит: "смотрю",
  наблюдает: "наблюдаю",
  находится: "нахожусь",
  стоит: "стою",
  ждет: "жду",
  ждёт: "жду",
};

/** These change only once the caller is known to be the subject of the sentence: alone they are often about a thing. */
const ONLY_AFTER_SELF = new Set(["может", "находится", "стоит", "ждет", "ждёт"]);

/** Somebody else named as the subject: then the verbs of the sentence are about him. */
const OTHERS = new Set(
  (
    "он она оно они никто кто-то кто каждый мужчина женщина ребенок ребёнок девочка мальчик подросток девушка парень муж жена сын дочь дочка " +
    "мама папа мать отец бабушка дедушка брат сестра внук внучка сосед соседка соседи водитель пассажир пассажиры человек люди пострадавший " +
    "пострадавшая больной больная полиция полицейский наряд бригада охранник охрана продавец врач врачи пожарные прохожий прохожая прохожие " +
    "знакомый знакомая друг подруга супруг супруга хозяин хозяйка рабочий рабочие дети старик старушка пенсионер пенсионерка мужик сотрудник " +
    "сотрудники диспетчер оператор"
  ).split(" "),
);

/** Verbs of another person's state or action: after one of them the sentence is about that person. */
const OTHERS_ACTION =
  /^(дышит|кричит|лежит|сидит|плачет|говорит|просит|зовет|зовёт|отвечает|издает|издаёт|спит|держит|бьет|бьёт|ругается|угрожает|ходит|едет|тонет|теряет|жалуется|стонет|хрипит|упал|упала|упали)$/;

const SELF = /^заявител(ь|ьница)$/;

function keepCase(original: string, word: string): string {
  return original[0] && original[0] !== original[0].toLowerCase() ? word[0].toUpperCase() + word.slice(1) : word;
}

/** One sentence (up to «.», «!», «?», «;»): the verbs turn when the caller is its subject. */
function sentence(text: string): string {
  let self = false;
  let other = false;
  let prev = "";
  return text.replace(/[А-Яа-яЁё-]+/g, (word) => {
    const w = word.toLowerCase();
    const before = prev;
    prev = w;
    if (SELF.test(w)) {
      self = true;
      other = false;
      return keepCase(word, "я");
    }
    if (w === "я") {
      self = true;
      other = false;
      return word;
    }
    if (OTHERS.has(w.replace(/ё/g, "е")) || OTHERS.has(w) || OTHERS_ACTION.test(w)) {
      other = true;
      return word;
    }
    const own = OWN[w];
    if (!own || other) return word;
    // «Может упасть на палатку» is about the board; «не может разбудить мужа» is the caller's own.
    if (ONLY_AFTER_SELF.has(w) && !self && !(w === "может" && before === "не")) return word;
    self = true;
    return keepCase(word, own);
  });
}

/** The ticket's note about the caller as the caller says it: «Номер дома не знает» → «Номер дома не знаю». */
export function firstPerson(text: string): string {
  if (!text) return text;
  return text
    .split(/(?<=[.!?…;])/)
    .map(sentence)
    .join("");
}
