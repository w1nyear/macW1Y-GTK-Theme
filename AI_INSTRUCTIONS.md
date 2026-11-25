# macW1Y — AI Instructions & Developer Manifesto

Цей документ є обов'язковим технічним маніфестом та єдиним джерелом істини (Single Source of Truth) для будь-якого ШІ-асистента, що працює з проектом `macW1Y` (`/home/vitaliy/macW1Y`).

---

## 1. Головні непорушні правила

1. **СУВОРО ЗАБОРОНЕНО `git push`**: Усі git-коміти мають бути виключно локальними (`git commit -am "..."`). Жодних віддалених пушів.
2. **ЗАБОРОНА ПЕРЕЗАВАНТАЖЕННЯ ХОСТА**: Категорично заборонено виконувати `reboot`, `poweroff`, `shutdown`, `loginctl terminate-session` чи переривати графічну сесію користувача.
3. **НЕ ЧІПАТИ GRUB PNG-ІКОНКИ**: Каталоги `grub/apple-mac/icons/`, `grub/apple-mac-usb/icons/` не чіпати і не додавати в коміти.
4. **МОВА СПІЛКУВАННЯ ТА ЗВІТІВ**: Усі відповіді, описи комітів та записи у `done.txt` ведуться виключно українською мовою.
5. **КЛІКАБЕЛЬНІ ПОСИЛАННЯ `file://`**: Усі згадані файли обов'язково оформлюються як посилання `file:///шлях/до/файлу`.
6. **БЕЗ КИРИЛИЦІ В СКРИПТАХ**: Файл `install.sh` не повинен містити кириличних символів.
7. **СУВОРА СИСТЕМНА БЕЗПЕКА ТА ЗАБОРОНА БЕКДОРІВ (SECURITY HARDENING)**: Категорично заборонено створювати або додавати файли в `etc/sudoers.d/`, які надають необмежені права `NOPASSWD: ALL` (як `99-mactheme`), хардкодити облікові записи користувачів (`vitaliy`) у правила sudoers, залишати права звичайного користувача на системні бінарники в `/usr/local/bin`, запускати скрипти з домашніх каталогів через systemd або використовувати небезпечні статичні шляхи в `/tmp` (детальніше у Розділі 7).

---

## 2. Синхронізація системи та проекту

**ОБОВ’ЯЗКОВЕ ПРАВИЛО ПІД ЧАС БУДЬ-ЯКОЇ ЗМІНИ ФАЙЛУ**: завжди, коли ти змінюєш або створюєш будь-який файл, ти зобов’язаний **синхронно й одночасно оновлювати і поточну живу систему (користувацькі та `root`-файли через `sudo`), і файли проекту в репозиторії, а також одразу адаптувати та перевіряти ці зміни під інші підтримувані дистрибутиви (`Ubuntu, Debian, Linux Mint, Fedora, Arch Linux, CachyOS`)**.
- **Утиліти та скрипти**: файли з `bin/` синхронізуються до `/usr/local/bin/` з правами `755` (та `root:root`).
- **Системні оверлеї та розширення**: `gnome-shell-overlay/ui/layout.js` синхронізується до `/usr/share/mactheme/gnome-shell-overlay/ui/layout.js`; `config/extensions.lock.json` — до `/usr/share/mactheme/config/extensions.lock.json` і `~/.config/macw1y/extensions.lock.json`; системні розширення GDM та Ubuntu (`wack-lockscreen-clock@rinzler69-wastaken.github.com`, `ding@rastersoft.com`) — до `/usr/share/gnome-shell/extensions/`, а користувацькі — до `~/.local/share/gnome-shell/extensions/`.
- **Спільні C-бібліотеки**: після редагування компілюються локально через `dependencies/build-native.sh` і розгортаються на всі системні шляхи (`/usr/lib/x86_64-linux-gnu`, `/usr/lib64`, `/usr/lib`, `/usr/local/lib`, `~/.local/lib`, `/usr/share/mactheme/...`).
- **Теми та ресурси**: синхронізуються між репозиторієм та каталогами `~/.themes/`, `~/.icons/`, `/usr/share/themes/`, `/usr/share/icons/`, `/usr/share/backgrounds/`.
- **Контроль розбіжностей**: команда `python3 bin/mac-audit-sync check` обов'язково повинна повертати **100% PASS** (0 розбіжностей).

---

## 3. Кросплатформна синхронізація (Ubuntu, Debian, Linux Mint, Fedora, Arch Linux, CachyOS)

**Кожен змінений або новий файл** (`install.sh`, скрипти та утиліти з `bin/`, C-бібліотеки, JS-розширення, GDM/GSettings-конфіги, systemd/autostart-сервіси, списки залежностей) під час будь-якого редагування має обов’язково адаптуватися та перевірятися на сумісність з **усіма підтримуваними дистрибутивами**: **Ubuntu, Debian, Linux Mint, Fedora, Arch Linux та CachyOS**:
- **Обов’язкова перевірка при кожній правці файлу**: не припускати поведінку лише Ubuntu — при зміні будь-якого компонента одразу враховувати відмінності дистрибутивів (GNOME 46–51, Nautilus/GTK версії, SELinux Enforcing у Fedora, GDM-профілі, `systemd`/D-Bus середовище, локалізацію) і синхронно оновлювати відповідні гілки коду та тести.
- **Пакетні менеджери та встановлення**: оновлення залежностей синхронно вноситься до `apt-packages.txt` (Debian/Ubuntu/Linux Mint), `dnf-packages.txt` (Fedora) та `pacman-packages.txt` (Arch/CachyOS).
- **Бібліотечні шляхи**: враховувати відмінності `SYS_LIB_DIR` — multiarch (`/usr/lib/x86_64-linux-gnu` у Debian/Ubuntu/Linux Mint), `/usr/lib64` (Fedora), `/usr/lib` (Arch/CachyOS).
- **Безпечні обгортки (Wrappers)**: обгортки Nautilus, GNOME Control Center та Ptyxis встановлюються виключно в `/usr/local/bin`, використовують динамічне визначення системного оригінального бінарника (`orig`) із захистом від рекурсії і не модифікують файли пакунків (`dpkg`, `rpm`, `pacman`).
- **GDM, теми та автозапуск**: формування `/etc/dconf/profile/gdm` має зберігати дистрибутивний `greeter-dconf-defaults` (`/var/lib/gdm3/greeter-dconf-defaults` у Debian/Ubuntu/Mint або `/usr/share/gdm/greeter-dconf-defaults` у Fedora/Arch), перевіряти `update-alternatives --query gdm-theme.gresource` перед симлінком `/usr/share/gnome-shell/gnome-shell-theme.gresource`, а також забезпечувати `dbus-run-session` fallback та `/etc/xdg/autostart/mac-ensure-extensions.desktop`.
- **Локалізація та SELinux**: генерація локалей має підтримувати `/etc/locale.gen` + `locale-gen` (Arch/CachyOS, Debian/Mint), `update-locale` і `localectl`; системні сервіси, бібліотеки та файли конфігурацій мають коректно працювати за увімкненого SELinux (`Enforcing` у Fedora).
- **Завантажувачі**: автоматичне розпізнавання GRUB 2 (`update-grub`, `grub2-mkconfig -o /boot/grub2/grub.cfg`, `grub-mkconfig -o /boot/grub/grub.cfg`) та безпечний пропуск без помилок для `systemd-boot` (CachyOS/Arch).
- **Initramfs**: підтримка генераторів через `macw1y_rebuild_initramfs` (`initramfs-tools`, `dracut`, `mkinitcpio`).
- **Схеми GSettings**: ізоляція специфічних для Ubuntu схем (`org.gnome.shell.ubuntu`) у `macw1y-gdm/99_ubuntu.gschema.override`. Усі виклики `gsettings set` захищаються суфіксом `2>/dev/null || true`.
- **Матриця версій GNOME (46–51) та захист розширень**: суворе дотримання діапазону GNOME 46–51 у `metadata.json` і коді всіх 21 керованих розширень (включно з `Clutter.Orientation`, fallback на `Clutter.OffscreenEffect` + `Cogl.Pipeline` + `Clutter.PipelineNode` замість видаленого у GNOME 51 `ShaderEffect.set_shader_source`, без `Clutter.get_default_backend()`, безпечним розблокуванням екрана та захистом від автооновлень із EGO) і синхронізація хешів у `config/extensions.lock.json`.

---

## 4. Правила ведення журналу done.txt

Кожен новий запис у [`done.txt`](file:///home/vitaliy/macW1Y/done.txt) оформлюється за чіткою структурою:
1. **Номер запису та дата**: наприклад, `828. 2026-11-19 — Назва виконаного завдання:`.
2. **Змінені файли та рядки**: точний список змінених файлів із зазначенням конкретних рядків або діапазонів змін (наприклад, `- install.sh (рядки 30-36, 772-780)`).
3. **Опис змін**: конкретний технічний опис внесених правок, виправлених помилок та результатів тестів.
4. **Синхронізація**: обов'язкове копіювання актуального `macW1Y/done.txt` до [`~/Desktop/done.txt`](file:///home/vitaliy/Desktop/done.txt).

---

## 5. Локальні коміти (Git Commits)

- Кожен завершений етап або виправлення фіксується окремим локальним комітом: `git commit -am "тип: опис змін українською мовою"`.
- Заборонено залишати незафіксовані робочі зміни перед завершенням завдання.
- Заборонено виконувати `git push`.

---

## 6. Обов'язковий чек-лист валідації перед здачею

Перед наданням фінальної відповіді користувачу обов'язково виконати перевірки:
```bash
python3 -m unittest discover -s tests -p 'test_*.py' # 39/39 PASS
python3 bin/mac-extension-guard verify               # 21/21 LOCKED OK
python3 bin/mac-audit-sync check                     # 100% PASS
perl -ne 'print if /[\x{0400}-\x{04FF}]/' install.sh # 0 збігів
python3 bin/test-macw1y-animations.py                # 12/12 PASS (на хості)
```
Завдання вважається завершеним лише за 100% проходження всіх тестів.

---

## 7. Стандарти системної безпеки та ізоляції привілеїв (Security Hardening)

Будь-який ШІ-асистент зобов'язаний неухильно дотримуватися наступних стандартів безпеки, щоб унеможливити виникнення вразливостей ескалації привілеїв (Privilege Escalation):

1. **Заборона бекдорів у `sudoers.d`**:
   - Категорично заборонено створювати правила на кшталт `<user> ALL=(ALL) NOPASSWD: ALL` або додавати персональні файли у `/etc/sudoers.d/` (файл `99-mactheme` повністю ліквідовано та заборонено до повторного створення).
   - Будь-які допоміжні правила sudoers (як-от для `mac-boot-config`) повинні:
     * Обмежуватися виключно системними адміністративними групами: `%sudo` (Debian/Ubuntu) та `%wheel` (Fedora/Arch).
     * Надавати дозвіл лише на конкретний системний бінарник (`/usr/local/bin/mac-boot-config`), без дозволу на інтерпретатори (`/usr/bin/python3`) чи підміну виконуваних файлів.
     * Обов'язково проходити перевірку синтаксису через `visudo -cf`.

2. **Суворий контроль прав володіння системними файлами (Root Ownership)**:
   - Усі системні бінарники (`/usr/local/bin/*`), спільні бібліотеки (`/usr/local/lib/*`, `/usr/lib/*`), конфігураційні файли (`/etc/*`) та системні ресурси (`/usr/share/mactheme/*`) повинні належати виключно `root:root`.
   - Заборонено використовувати `cp -a` або `rsync -a` під `sudo` без скидання прав володіння (`--no-owner --no-group --chown=root:root`), оскільки це переносить права звичайного користувача на системні файли і створює критичний вектор локальної рут-ескалації.
   - Бінарні файли повинні мати права `755`, системні конфігураційні файли та бібліотеки — `644`, файли sudoers — `440`.

3. **Заборона запуску скриптів з домашнього каталогу через `systemd`**:
   - Системні служби `systemd` (наприклад, `mac-grub-status.service`) ніколи не повинні містити `ExecStart=` на файли в `/home/*`.
   - Усі скрипти, які виконуються системними демонами або службами від імені root, повинні розміщуватися у системних каталогах (`/usr/share/mactheme/...` або `/usr/local/bin/...`) із правами володіння `root:root (0755)`.

4. **Безпечні тимчасові каталоги (Захист від Symlink / Race Attack)**:
   - Заборонено використовувати фіксовані передбачувані шляхи у `/tmp/` (наприклад, `/tmp/gnome-rounded-blur`, `/tmp/macW1Y-build-installer`).
   - Будь-які тимчасові файли або директорії під час складання чи встановлення мають створюватися виключно через `mktemp -d /tmp/назва.XXXXXX` із гарантованим очищенням за допомогою `trap` або блоків очищення.

5. **Динамічний контекст користувача (Без хардкоду `vitaliy` чи `/home/vitaliy`)**:
   - Утиліти та скрипти не повинні містити зашитих імен користувачів чи абсолютних шляхів `/home/vitaliy/`.
   - Завжди використовувати динамічне визначення: `$SUDO_USER` / `$USER`, `pwd.getpwuid(1000).pw_name`, `GLib.get_home_dir()`, `os.path.expanduser("~")`.

6. **Політика повідомлення про вразливості**:
   - Дотримуватися стандартів, зафіксованих у [SECURITY.md](file:///home/vitaliy/MACTHEMEFILES/SECURITY.md). Про всі потенційні ризики безпеки звітувати у приватному порядку або документувати згідно з протоколом.
