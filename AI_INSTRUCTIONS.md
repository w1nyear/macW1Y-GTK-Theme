# macOS Tahoe / Sequoia Transformation Pack for Ubuntu (GNOME Shell 50 на Wayland)
## Головний маніфест та технічний довідник розробника для ШІ / AI Developer Handbook

Цей файл є обов'язковою інструкцією для будь-якого ШІ-асистента, який продовжує розробку, виправляє баги чи оптимізує цей проект. **Перед початком будь-якої роботи уважно прочитай цей документ!**

---

## 1. Залізні правила та непорушні обмеження проекту

> [!CAUTION]
> **ПРАВИЛО 1: СУВОРО ЗАБОРОНЕНО `git push`**
> Ніколи, ні за яких умов не виконуйте команду `git push` або будь-які відправлення у віддалені репозиторії! Усі коміти мають бути виключно **локальними** (`git commit -m "..."`).

> [!IMPORTANT]
> **ПРАВИЛО 2: МОВА СПІЛКУВАННЯ — ВИКЛЮЧНО УКРАЇНСЬКА**
> Усі відповіді користувачеві, пояснення, коментарі в чаті та записи в журналі `done.txt` ведуться **суворо українською мовою**.

> [!IMPORTANT]
> **ПРАВИЛО 3: ОБОВ'ЯЗКОВІ КЛІКАБЕЛЬНІ ПОСИЛАННЯ `file://`**
> Кожен файл, клас, метод, константа чи шлях, згаданий у вашій відповіді, **МУСИТЬ** бути оформлений як клікабельне markdown-посилання формату GitHub із протоколом `file://`, наприклад:
> - [`applications_menu_v5b.js`](file:///home/vitaliy/.local/share/gnome-shell/extensions/appmenu@ChathurangaBW.github.io/applications_menu_v5b.js)
> - [`open()`](file:///home/vitaliy/.local/share/gnome-shell/extensions/appmenu@ChathurangaBW.github.io/applications_menu_v5b.js#L1110-L1180)
> - [`styling.json`](file:///home/vitaliy/.config/mac-styling/styling.json)

> [!IMPORTANT]
> **ПРАВИЛО 4: СИНХРОНІЗАЦІЯ З ГОЛОВНИМ РЕПОЗИТОРІЄМ**
> Фізична папка проєкту — це `/home/vitaliy/macW1Y/`, а `/home/vitaliy/MACTHEMEFILES` — це символічне посилання (symlink) на неї:
> `MACTHEMEFILES -> /home/vitaliy/macW1Y`
> Вони вказують на одні й ті самі фізичні файли на диску.
> Будь-яка зміна у робочій системі (`~/.local/share/gnome-shell/extensions/...`, `~/.themes/...`, `~/.config/...`) **НЕГАЙНО** копіюється в репозиторій `~/macW1Y/` (або через symlink `~/MACTHEMEFILES/`). Робити подвійне копіювання в обидва шляхи не потрібно. Репозиторій є основним джерелом істини (Source of Truth).

> [!IMPORTANT]
> **ПРАВИЛО 5: ЖУРНАЛ `done.txt` ТА ЛОКАЛЬНИЙ ГІТ-КОМІТ**
> Після виконання кожного завдання:
> 1. Допишіть структурований звіт у кінець [`done.txt`](file:///home/vitaliy/MACTHEMEFILES/done.txt) з новим номером етапу.
> 2. Зробіть локальний коміт: `git add -A && git commit -m "..."` у папці `/home/vitaliy/MACTHEMEFILES/`.

> [!WARNING]
> **ПРАВИЛО 6: ПРЕФІКС `LD_PRELOAD=` У ТЕРМІНАЛІ**
> У системному середовищі може бути експортована пошкоджена бібліотека `libmacpopover.so`. Через це виконання системних команд або python-скриптів без очищення оточення повертає помилку. Завжди починайте виконання команд bash/python з:
> ```bash
> LD_PRELOAD= <ваша команда>
> ```

---

## 2. Що це за проект та архітектура системи

Це проект ультрареалістичної трансформації Ubuntu у **macOS Tahoe / Sequoia** на базі **GNOME Shell 50.1 під керуванням Wayland**.

### Архітектура активних компонентів та розширень:
1. **[`liquid-glass@thinkingcoding1231.gmail.com`](file:///home/vitaliy/.local/share/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com/)**
   - Власний конвеєр GLSL-шейдерів для матового рідкого скла (`BackdropGlass`).
   - Клонує вікна через `WindowCloneManager`, семплує UI через `UILayerSampler`, генерує фізично коректну рефракцію, хроматичну аберацію та м'яке освітлення країв (rim light).
2. **[`appmenu@ChathurangaBW.github.io`](file:///home/vitaliy/.local/share/gnome-shell/extensions/appmenu@ChathurangaBW.github.io/)**
   - Меню програми у верхній панелі (Global Menu).
   - **Spotlight** (`searchDialog_v5.js`): спливаюча пілюля пошуку з морфінгом.
   - **Центр програм / Launchpad** (`applications_menu_v5b.js`): сітка додатків, категорії, пошук.
   - **Історія буфера обміну** (`clipboardDialog_v2.js`): картки скопійованих фрагментів.
3. **[`kiwi@kemma`](file:///home/vitaliy/.local/share/gnome-shell/extensions/kiwi@kemma/)**
   - **Центр сповіщень macOS Tahoe** (`apps/tahoeNotifications.js`, `apps/tahoeNotificationCard.js`): темні акрилові картки сповіщень, групування у стопки, підтримка розмиття.
4. **[`blur-my-shell@aunetx`](file:///home/vitaliy/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/)**
   - Верхня панель `menubar_v29.js`, огляд (overview), швидкі параметри.
   - Підсистема стилізації `styling.json`.
5. **[`eval-helper@mactheme`](file:///home/vitaliy/.local/share/gnome-shell/extensions/eval-helper@mactheme/)**
   - D-Bus інтерфейс `org.gnome.Shell.Extensions.EvalHelper` за шляхом `/org/gnome/Shell/Extensions/EvalHelper`.
   - Дозволяє виконувати довільний JavaScript у контексті GNOME Shell з python-скриптів.
6. **[`tahoe-widgets@micronix`](file:///home/vitaliy/.local/share/gnome-shell/extensions/tahoe-widgets@micronix/)**
   - Віджети на робочому столі (Погода, Календар, Годинник, Дата) з рідким склом.
7. **[`wack-lockscreen-clock@rinzler69-wastaken.github.com`](file:///home/vitaliy/.local/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com/)**
   - Екран блокування та GDM гретер у стилі Cupertino.
8. **[`dash2dock-motion@unmade.space`](file:///home/vitaliy/.local/share/gnome-shell/extensions/dash2dock-motion@unmade.space/) та [`cupertino-dock-lite`](file:///home/vitaliy/.local/share/gnome-shell/extensions/cupertino-dock-lite@rinzler69-wastaken.github.com/)**
   - Нижня Dock-панель із фізикою збільшення іконок та скляним матовим тінтом.

---

## 3. Візуальний канон та специфікація елементів (Design Standards)

Усі елементи інтерфейсу мають суворо відповідати мові дизайну macOS Tahoe / Sequoia:

### 1. Центр сповіщень (Notification Center) та плаваючі банери
- **Стиль картки**: насичений темний матовий акрил з розмиттям:
  ```css
  background-color: rgba(45, 45, 47, 0.76) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 16px !important;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35) !important;
  ```
- **Заокруглення**: суворо `16px` (у конфігу `~/.config/mac-styling/styling.json` параметр `notif_radius` має бути `16`).
- **Верхній рядок**: розділений flex-розпіркою:
  - Ліворуч: іконка програми (36x36px, `border-radius: 9px`, `clip_to_allocation: true`), назва програми (жирний білий текст 13px), лічильник стопки.
  - Праворуч: часова мітка ("14:22" або "Вчора, 18:30"), яка при наведенні курсору плавно поступається місцем кнопці закриття (✕).
- **Заголовок та дублювання**: якщо заголовок збігається з назвою застосунку (наприклад, "Antigravity"), заголовок приховується.
- **Тіло сповіщення (Body Text)**: багаторядкове перенесення! Ширина текстового контейнера 366px, `line_wrap: true`, `single_line_mode: false`, `wrap_mode: Pango.WrapMode.WORD_CHAR`. Текст ніколи не повинен обрізатися в один рядок із трикрапкою!
- **Кнопки дій**: прямокутні капсули із заокругленням 7px, паддінгами `4px 12px`, напівпрозорою підкладкою `rgba(255, 255, 255, 0.16)` у правому нижньому кутку.
- **Стопки (MacNotificationGroup)**: підкладки `layer1` (`rgba(38, 38, 40, 0.72)`) та `layer2` (`rgba(30, 30, 32, 0.65)`) з виступом 6px та 11px знизу. Внутрішні шари не повинні просвічувати крізь текст!

### 2. Spotlight (Пошук ⌘Space)
- **Пілюля в спокої**: ширина 714px, висота 54px, заокруглення 26px (`CORNER_RADIUS = 26.0`).
- **Рідке скло**: `BackdropGlass` з `owner: 'spotlight'`, паддінг 0, розмиття 8.0, тінт темний `rgba(0.16, 0.16, 0.18, 0.12)`.
- **Розширення**: плавний морфінг за висотою при введенні запиту або перемиканні категорій (Файли, Програми, Буфер).

### 3. Центр програм (Applications Center / Launchpad)
- **Розміри**: ширина 714px, висота 530px, заокруглення 26px.
- **Сітка**: 7 колонок (`COLUMNS = 7`), ширина колонки 94px, розмір іконки 52px.
- **Рядок заголовка**: іконка App Store (синя літера "A"), рядок пошуку з підказкою `| Програми`, кнопка дій "...".
- **Категорії**: перемикачі (Утиліти, Спілкування, Продуктивність, Інше) з горизонтальним вирівнюванням.
- **Підкладка**: динамічний `BackdropGlass` із обов'язковим викликом `forceRefresh(1)` при відкритті, щоб скло не показувало старий застиглий буфер.

### 4. Верхня панель (MenuBar)
- **Висота**: суворо 28px (`height: 28px !important; min-height: 28px !important`).
- **Відступи праворуч**: суворо 8px між усіма елементами індикаторів (`margin: 2px 4px !important`).
- **Порядок іконок справа**:
  `[Трей сторонніх додатків] -> [Wi-Fi] -> [Bluetooth] -> [Звук] -> [Батарея (одна!)] -> [Мова (uk/en)] -> [Control Center (34x28px)] -> [Дата/Час]`.
- **Control Center Button**: пілюля 34x28px з іконкою повзунків, що відкриває меню впритул до правого краю екрана.

### 5. Екран блокування (GDM Lock Screen)
- **Стиль**: Cupertino (wack-lockscreen-clock + user-theme).
- **Шпалери**: `/usr/share/backgrounds/GoldenGate_Day.jpg`.
- **Тема Shell**: `macW1Y-Dark`.
- **Шрифти**: `SF Pro Text` / `SF Pro Display`.
- **Тіні**: легкі напівпрозорі тіні під годинником та датою (`0 1px 3px rgba(0, 0, 0, 0.20)`).

---

## 4. Технічні підводні камені та правила розробки (GJS / Clutter / Wayland)

### 1. Кешування ES-модулів у GJS (GNOME Shell 45+ / 50+)
> [!WARNING]
> GJS кешує імпортовані ES-модулі в пам'яті процесу GNOME Shell за їхнім URI. 
> Статичні імпорти на початку файлу (`import ... from './file.js'`) кешуються назавжди! Навіть вимкнення та повторне увімкнення розширення (`disableExtension` / `enableExtension`) **НЕ призводить** до повторного читання файлів з диска!

**Як правильно застосовувати зміни без повного перезапуску системи:**
1. **Для допоміжних файлів розширень**:
   Використовуйте версіонування у динамічних імпортах:
   ```javascript
   const mod = await import(`${baseUri}/myModule.js?v=${Date.now()}`);
   ```
   Або створюйте нову версію файлу (`file_v5b.js`) та оновлюйте імпорт.
2. **Для повного оновлення розширення**:
   У GNOME Shell 50 доступний спеціальний метод `reloadExtension`:
   ```javascript
   const ext = Main.extensionManager.lookup('appmenu@ChathurangaBW.github.io');
   await Main.extensionManager.reloadExtension(ext);
   ```
   Він повністю скидає кеш та перезавантажує модуль розширення без розриву сесії!

### 2. Специфіка Wayland
- На відміну від X11, на Wayland функція `Meta.restart()` **не працює**.
- Перезапуск GNOME Shell на Wayland означає завершення сеансу (logout).
- Тому **всі налагодження та тестування** проводяться виключно в живому режимі через D-Bus EvalHelper без перезапуску оболонки!

### 3. Як тестувати та викликати код через `EvalHelper`
У системі розгорнуто `eval-helper@mactheme`. Викликати будь-який код JS можна з python:
```python
import dbus

bus = dbus.SessionBus()
obj = bus.get_object('org.gnome.Shell', '/org/gnome/Shell/Extensions/EvalHelper')
iface = dbus.Interface(obj, 'org.gnome.Shell.Extensions.EvalHelper')

code = """(() => {
    // Ваш код тут
    return JSON.stringify({ ok: true });
})()"""
print(iface.Eval(code))
```

### 4. Робота з `BackdropGlass` (Liquid Glass)
- При створенні `BackdropGlass`:
  Обов'язково додавайте виключення (`addExclusion`) для самого діалогу, його контейнера та бекдропу, щоб скло не намагалося розмити саме себе.
- При відкритті діалогу:
  Завжди викликайте `this._glass.forceRefresh(1)`, щоб оновити клони вікон і захопити актуальний екран під склом.
- При закритті діалогу:
  Ніколи не залишайте старе скло висіти у пам'яті. Викликайте `destroy()` або приховуйте його з плавним `ease({ opacity: 0 })`.
- **Запобігання витоку акторів у `uiGroup`**:
  Перед створенням нового екземпляра діалогу завжди перевіряйте наявність старих осиротілих акторів у `Main.layoutManager.uiGroup` і знищуйте їх, інакше GPU буде перевантажений закільцьованими шейдерами!

### 5. Обов'язкова валідація GObject акторів
У середовищі GJS не можна просто писати `if (actor)`. Якщо C-об'єкт було знищено в Mutter, звернення до його властивостей викине критичний виняток `Object has been already deallocated`.
**Завжди використовуйте перевірки:**
```javascript
const _gobjectToString = GObject.Object.prototype.toString;

function _isActorValid(actor) {
    if (!actor) return false;
    try {
        const desc = _gobjectToString.call(actor);
        if (desc.includes('(DISPOSED)') || desc.includes('(FINALIZED)')) return false;
        if (actor._cleanedUp) return false;
        return typeof actor.visible === 'boolean';
    } catch (_) {
        return false;
    }
}

function _isGlassAlive(glass) {
    if (!glass) return false;
    try {
        const desc = _gobjectToString.call(glass);
        if (desc.includes('(DISPOSED)') || desc.includes('(FINALIZED)')) return false;
        if (glass._cleanedUp) return false;
        return typeof glass.visible === 'boolean' && glass.get_parent() !== null;
    } catch (_) {
        return false;
    }
}
```

### 6. Взаємне виключення меню (`_macCloseAllCenters`)
macOS одночасно показує лише одне головне спливаюче меню. У системі оголошена глобальна функція `globalThis._macCloseAllCenters(callerName)`.
При відкритті будь-якого меню (Spotlight, Applications, Notification Center, Control Center, Clipboard) необхідно викликати:
```javascript
if (typeof globalThis._macCloseAllCenters === 'function') {
    globalThis._macCloseAllCenters('applications'); // або 'spotlight' тощо
}
```

---

## 5. Покроковий алгоритм дій ШІ при отриманні завдання (Step-by-Step Workflow)

Коли користувач просить внести правку, полагодити баг чи змінити поведінку:

1. **Діагностика**:
   - Перевірте стан розширення через `EvalHelper` або `journalctl -xe --since "2 minutes ago"`.
   - З'ясуйте точну помилку, рядок коду та причину.
2. **Внесення виправлень**:
   - Відредагуйте цільовий файл у робочому каталозі `~/.local/share/gnome-shell/extensions/...`.
   - Дотримуйтесь правил валідації акторів, безпечних блоків `try ... catch` та уникнення витоків.
3. **Застосування змін (Hot Reload)**:
   - Перезавантажте модуль через `Main.extensionManager.reloadExtension(ext)`.
   - Перевірте через python/dbus стан: `ext.state === 1 (ENABLED)` і відсутність помилок `ext.error`.
4. **Тестування та перевірка**:
   - Програмно викличте функцію відкриття/закриття меню або відповідної дії.
   - Переконайтеся, що всі елементи мають коректну непрозорість (`opacity: 255`), геометрію та обробники подій.
5. **Синхронізація та фіксація**:
   - Скопіюйте всі змінені файли до `/home/vitaliy/MACTHEMEFILES/` та `/home/vitaliy/macW1Y/`.
   - Додайте новий розділ до [`done.txt`](file:///home/vitaliy/MACTHEMEFILES/done.txt).
   - Зробіть локальний коміт у git (`git add -A && git commit -m "..."`). **СУВОРО БЕЗ GIT PUSH!**
6. **Відповідь користувачеві**:
   - Надайте чітку, лаконічну відповідь українською мовою з клікабельними `file://` посиланнями на всі змінені файли та ключові функції.
