/**
 * Shortcuts of the 112 place for the trainee's memo. The list mirrors the key handlers of the workstation
 * (src/app/op112/ui/CardScreen.tsx for Alt + key and Shift+F1 / F2, WaitingScreen.tsx for Insert); op112-keys.test.ts
 * checks that every shortcut handled there is listed here and nothing else is. As in the instruction, some keys
 * mean one thing while the card is being filled and another in a saved card («режим просмотра»).
 */
export type HelpKey = {
  keys: string;
  what: string;
  /** KeyboardEvent.code values of the Alt handler this line describes («Shift+F1» for a Shift key). */
  codes?: string[];
};

export const OP112_KEYS: HelpKey[] = [
  { keys: "Insert или Enter", what: "принять входящий вызов" },
  { keys: "Alt+F1 / Alt+F2 / Alt+F3", what: "телефоны: АОН / предоставленный / телефон на место", codes: ["F1", "F2", "F3"] },
  { keys: "Alt+Q", what: "фамилия и имя заявителя", codes: ["KeyQ"] },
  { keys: "Alt+K", what: "канал связи", codes: ["KeyK"] },
  { keys: "Alt+A", what: "строка адреса", codes: ["KeyA"] },
  { keys: "Alt+P", what: "отметить или снять «Пострадавшие»", codes: ["KeyP"] },
  {
    keys: "Alt+N",
    what: "к кнопкам «нет контакта» / «срыв звонка», пока тип происшествия не выбран; в сохранённой карточке — «Вернуть на доработку» (в статусе «Проверена»)",
    codes: ["KeyN"],
  },
  { keys: "Alt+T", what: "«что случилось?» — тип происшествия", codes: ["KeyT"] },
  { keys: "Alt+R", what: "значимые типы происшествий", codes: ["KeyR"] },
  { keys: "Alt+1 … Alt+9", what: "перейти к опросной карте с этим номером", codes: ["Digit"] },
  { keys: "Alt+Ctrl+1 … 9", what: "строка с этим номером в опросной карте, где вы сейчас", codes: ["Ctrl+Digit"] },
  { keys: "Alt+O", what: "описание со слов заявителя; в сохранённой карточке — блок отработок", codes: ["KeyO"] },
  { keys: "Alt+Z", what: "окно «Добавьте службы»", codes: ["KeyZ"] },
  { keys: "Alt+S", what: "«сохранить» → «оповестить и сохранить карточку» → «отработана»; при дополнении — «сохранить» дополнение", codes: ["KeyS"] },
  { keys: "Alt+V", what: "важное происшествие (ЧС)", codes: ["KeyV"] },
  { keys: "Alt+J", what: "поле разговора с заявителем", codes: ["KeyJ"] },
  { keys: "Shift+F1", what: "сохранённая карточка: меню «Просмотр» (выйти из дополнения без сохранения)", codes: ["Shift+F1"] },
  { keys: "Shift+F2", what: "сохранённая карточка: меню «Дополнить» — пустые при сохранении поля, описание, «Пострадавшие»", codes: ["Shift+F2"] },
  { keys: "Alt+Y", what: "сохранённая карточка: «Проверена» (в статусе «Проверена»)", codes: ["KeyY"] },
  { keys: "Esc", what: "закрыть открытое окно" },
  { keys: "Alt+W, Alt+B, Alt+M", what: "в учебной версии не используются: связи, напоминание, сообщение о проблеме", codes: ["KeyW", "KeyB", "KeyM"] },
];
