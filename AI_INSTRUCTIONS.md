# macOS Tahoe / Sequoia Transformation Pack for Ubuntu 24.04 (GNOME 46)
## Інструкція для ШІ-асистента / AI Developer Handbook

Цей файл є головним технічним путівником та маніфестом для ШІ, який продовжує роботу над цим проектом або збирає фінальний модпак.

---

## 1. Що це за проект?
Це комплексний, ультрареалістичний модпак глибокої трансформації дистрибутива **Ubuntu 24.04 (GNOME Shell 46 на Wayland)** у вигляд та поведінку **macOS (стиль macOS Tahoe / Sequoia)**.

На відміну від поверхневих тем GTK, у цьому проєкті реалізовано:
1. **Справжній динамічний блюр (Liquid Glass / Dynamic Blur):**
   - Меню-бар та Dock-панель мають розмиття відносно реальних вікон додатків позаду (браузер, файловий менеджер, медіаплеєр тощо), а не лише статичних шпалер.
   - Рідний скляний тінт, що точно повторює колірні шари macOS.
2. **Apple MenuBar (Верхня панель):**
   - Ліворуч: іконка Apple () з повноцінним системним меню macOS ("Про цей Mac", "Системні параметри", "Примусово завершити", "Перезапуск", "Вимкнути"), меню поточної активної програми, глобальні підменю.
   - Праворуч: точний порядок елементів macOS:
     `[Privacy Mic/Cam (якщо активні)] -> [Трей додатків (AnyDesk, Antigravity тощо)] -> [Wi-Fi] -> [Bluetooth] -> [Звук] -> [Батарея (суворо одна!)] -> [Мова (uk/en)] -> [Control Center (34x28px)] -> [Дата й час (годинник)]`.
   - Індивідуальні спливаючі картки швидкого керування для Wi-Fi, Bluetooth та Звуку у стилі розгорнутих блоків Control Center (з круглими тумблерами, списками пристроїв, інтерактивним слайдером гучності).
   - Кнопка Control Center: компактна пілюля 34px × 28px з оригінальною іконкою двох повзунків (`control-center.png`), що відкриває меню впритул до верхнього правого кутка екрана.
   - Висота всіх кнопок панелі: суворо 28px; відступи між елементами: суворо 8px (`margin: 2px 4px !important`).
   - Усі неактивні системні індикатори GNOME (`tiling-assistant`, `unattended_upgrade` тощо) примусово приховані (`width: 0`), щоб між треєм і Wi-Fi не було порожніх дірок.
3. **Dock-панель (Dash to Dock):**
   - Заокруглення радіуса панелі: суворо 28px (як у темі MacTahoe).
   - Усунено всі артефакти прямих кутів і розривів фону.
   - Живе розмиття елементів позаду дока як на робочому столі, так і у віконному режимі.
4. **Спливаючі сповіщення (Notifications):**
   - Анімація плавного виїзду з правого краю екрана.
   - Скляний блюр із напівпрозорим тінтом.
5. **Сторінка «Mac стилізація» у Параметрах системи:**
   - Інтеграція безпосередньо у додаток `Параметри` (`gnome-control-center`) у розділ **«Система»**.
   - Реалізовано через бібліотеку `libmac_settings.so` (інжекція GtkActionRow у шаблон `cc-system-panel.ui`).
   - Відкриває окремий графічний конфігуратор (`mac-styling-settings` на GTK4/Adwaita) для живого регулювання блюру, тінту, кольорів та радіусів заокруглень.

---

## 2. Що за папка `~/MACTHEMEFILES/`?
Папка `/home/vitaliy/MACTHEMEFILES/` — це **Головний вихідний репозиторій (Source of Truth / Staging Directory)** усього проєкту.

### Структура папки `~/MACTHEMEFILES/`:
```text
~/MACTHEMEFILES/
├── install.sh                  # Головний інсталяційний скрипт (розгортання проєкту в 1 клік)
├── done.txt                    # Детальний журнал усіх виконаних етапів розробки (Етапи 1-11)
├── README.md                   # Короткий опис проєкту
├── AI_INSTRUCTIONS.md          # Цей маніфест інструкцій для ШІ
├── applications/               # .desktop файли для запуску конфігуратора та оверлею Settings
│   ├── mac-styling-settings.desktop
│   └── org.gnome.Settings.desktop
├── bin/                        # Виконувані бінарники та скрипти
│   ├── gnome-control-center    # Wrapper із завантаженням нашої бібліотеки через LD_PRELOAD
│   └── mac-styling-settings    # GTK4/Adwaita додаток налаштувань блюру/радіусів
├── blur-my-shell/              # Модифікований рушій блюру та меню-бара
│   ├── components/
│   │   ├── menubar.js          # Логіка верхньої панелі (Apple menu, окремі меню Wi-Fi/BT/Audio/Battery, CC)
│   │   ├── quick_settings.js   # Позиціонування та стиль Control Center
│   │   ├── notifications.js    # Анімація виїзду справа та скляний ефект сповіщень
│   │   └── dash_to_dock.js     # Блюр та геометрія дока
│   ├── effects/                # Шейдери GLSL та конвеєр динамічного розмиття
│   └── styles/                 # Специфічні стилі панелей
├── control-center/             # Сирці та UI інтеграції в системні параметри
│   ├── libmac_settings.c       # C-код перехоплення GtkBuilder для додавання кнопки у "Система"
│   └── cc-system-panel.ui      # Модифікований UI-шаблон вікна системи
├── dash-to-dock/               # Патчі для розширення Dash to Dock
│   ├── dash.js                 # Усунення артефактів кутів та виправлення offscreen_redirect
│   └── stylesheet.css          # Стилі дока (радіус 28px)
├── dconf/                      # Експортовані дампи налаштувань GNOME, D2D та Blur My Shell
│   ├── blur-my-shell.dconf
│   ├── dash-to-dock.dconf
│   └── gnome-shell.dconf
├── gnome-shell-theme/          # Кастомний CSS теми оболонки
│   └── gnome-shell.css         # Тема MacTahoe-Dark з нашими виправленнями (відступи 8px, висота 28px)
├── icons/                      # Системні іконки проекту
│   ├── control-center.png      # Оптимізована растрова іконка Control Center (із Завантажень користувача)
│   └── control-center-symbolic.svg
├── lib/                        # Скомпільовані бінарні бібліотеки
│   └── libmac_settings.so      # Скомпільований хук для gnome-control-center
└── services/                   # D-Bus сервіси
    └── org.gnome.Settings.service
```

---

## 3. Де ці файли працюють у реальній системі (Цільові шляхи)
Коли система працює, файли розгорнуті у таких системних місцях користувача:
1. **Теми GNOME Shell:**
   - `~/.themes/MacTahoe-Dark/gnome-shell/gnome-shell.css`
   - `~/.themes/MacTahoe-Dark-solid/gnome-shell/gnome-shell.css`
2. **Розширення Blur My Shell:**
   - `~/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/`
3. **Розширення Dash to Dock:**
   - `~/.local/share/gnome-shell/extensions/dash-to-dock@micxgx.gmail.com/`
4. **Іконки Control Center:**
   - `~/.themes/MacTahoe-Dark/icons/control-center.png`
   - `~/.themes/MacTahoe-Dark-solid/icons/control-center.png`
   - `~/.local/share/icons/hicolor/scalable/apps/control-center.png`
5. **Бінарники та скрипти:**
   - `~/.local/bin/mac-styling-settings`
   - `~/.local/bin/gnome-control-center`
6. **Бібліотека хука:**
   - `~/.local/lib/libmac_settings.so`
7. **Копії для користувача на Робочому столі:**
   - `~/Робочий стіл/done.txt`
   - `~/Робочий стіл/install.sh`

---

## 4. Залізні правила для наступного ШІ під час роботи

> [!IMPORTANT]
> **ПРАВИЛО 1: ДЗЕРКАЛЬНА СИНХРОНІЗАЦІЯ З `~/MACTHEMEFILES/`**
> Якщо ви редагуєте будь-який файл у робочій системі (наприклад, `menubar.js` або `gnome-shell.css`), ви **НЕГАЙНО** зобов'язані скопіювати його в `~/MACTHEMEFILES/`. Папка `~/MACTHEMEFILES/` ніколи не повинна відставати від живої системи!

> [!IMPORTANT]
> **ПРАВИЛО 2: ОНОВЛЕННЯ ЖУРНАЛУ ТА РОБОЧОГО СТОЛУ**
> Після виконання нового завдання:
> 1. Допишіть звіт про новий етап у кінець `~/MACTHEMEFILES/done.txt`.
> 2. Якщо додалися нові файли чи ресурси, додайте їхнє копіювання в `~/MACTHEMEFILES/install.sh`.
> 3. Скопіюйте оновлені `done.txt` та `install.sh` на `~/Робочий стіл/`.

> [!WARNING]
> **ПРАВИЛО 3: СПЕЦИФІКА GNOME SHELL 46 / CLUTTER / GJS**
> - **Відступи панелі:** Між усіма кнопками праворуч відступ суворо 8px (`margin: 2px 4px !important`).
> - **Висота кнопок панелі:** Суворо 28px (`height: 28px !important; min-height: 28px !important`). Без прозорих рамок, які здавлюють підсвічування!
> - **Іконка Control Center:** Обнуляти `-minimum-hpadding` та `-natural-hpadding` через слухач `style-changed`, щоб GJS не звужував розмір іконки до 0px. Кнопка має розмір 34x28px.
> - **Батарейка:** Тільки один екземпляр (`macBattery`). Будь-які дублі з QuickSettings від'єднуються і ховаються.
> - **Неактивні індикатори трею:** Мають бути `hide()`, `width: 0`, `margin: 0` і зміщені в кінець після годинника, щоб не створювати порожніх дірок перед Wi-Fi.
> - **Перезавантаження розширень для перевірки змін:**
>   `gnome-extensions disable blur-my-shell@aunetx && sleep 1 && gnome-extensions enable blur-my-shell@aunetx`

---

## 5. Що робити при фінальній збірці модпаку (Release / Packaging)

Коли користувач скаже: **«збираємо повний модпак проєкту»** або **«зроби релізний архів»**:
1. **Звірка файлів:** Переконатися, що `~/MACTHEMEFILES/` містить усі свіжі версії файлів із живої системи.
2. **Перевірка інсталятора:**
   - Перевірити `~/MACTHEMEFILES/install.sh`. Скрипт має мати прапорець виконання (`chmod +x`).
   - Перевірити, що він копіює всі каталоги: `applications`, `bin`, `lib`, `icons`, `control-center`, `dconf`, `blur-my-shell`, `dash-to-dock`, `gnome-shell-theme`.
   - Перевірити імпорт налаштувань через `dconf load`, оновлення `update-desktop-database` та `gtk-update-icon-cache`.
3. **Створення скрипта деінсталяції `uninstall.sh`:**
   - Скрипт, який відновлює дефолтні налаштування Ubuntu, вимикає кастомні модулі та повертає стандартну тему Yaru.
4. **Створення релізного архіву:**
   - Створити архів `mac-tahoe-modpack.tar.gz` або `mac-tahoe-modpack.zip` у папці користувача або на Робочому столі:
     `tar -czvf ~/Робочий\ стіл/mac-tahoe-modpack-v1.0.tar.gz -C ~ MACTHEMEFILES`
5. **Тест чистого розгортання:**
   - Перевірити, що користувач на будь-якій чистій Ubuntu 24.04 з GNOME 46 може розпакувати архів і виконати:
     ```bash
     cd MACTHEMEFILES && ./install.sh
     ```
     і отримати повністю готове, ідентичне налаштування робочого оточення macOS.
