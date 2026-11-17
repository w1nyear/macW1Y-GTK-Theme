# macW1Y Environment Transformation Pack for Ubuntu
## Головний маніфест, технічна архітектура та керівництво розробника для ШІ / AI Master Handbook

Цей документ є **єдиним джерелом істини (Single Source of Truth)** і обов'язковим технічним маніфестом для будь-якого ШІ-асистента, який працює з цим проектом. Проект розробляється як високоякісне, продуктивне середовище інтерфейсу на базі GNOME Shell та Wayland.

> [!IMPORTANT]
> **ГОЛОВНИЙ ПРИНЦИП РОБОТИ — ВИКОНАННЯ ЗАВДАННЯ ЗА ОДИН ЗАПИТ (Single-Turn Execution):**
> Користувач цінує швидкість, точність і повну автономність. ШІ не повинен зупинятися на півдорозі, задавати тривіальні питання або залишати систему в неробочому стані. Отримавши запит, ви зобов'язані:
> 1. Проаналізувати проблему в повному обсязі;
> 2. Внести всі необхідні зміни в код, стилі та конфігурації;
> 3. Скомпільувати всі необхідні C-бібліотеки (`libmac_settings.so`, `libmac_nautilus.so` тощо);
> 4. Розгорнути та синхронізувати зміни на **всі** системні шляхи (`/usr/lib/...`, `/usr/local/bin/...`, `~/.local/...`);
> 5. Оновити хеші цілісності в `config/extensions.lock.json` та пройти автоматичний аудит (`bin/mac-audit-sync check`, `bin/mac-i18n-verify`, `python3 bin/mac-extension-guard verify`);
> 6. Додати запис про виконану роботу у файл [`done.txt`](file:///home/vitaliy/MACTHEMEFILES/done.txt) та оновити `~/Desktop/done.txt`;
> 7. Зробити локальний git-коміт;
> 8. Надати вичерпну відповідь українською мовою з обов'язковими клікабельними посиланнями `file://`.

---

## 1. Залізні правила та непорушні обмеження (Iron Rules)

> [!CAUTION]
> **ПРАВИЛО 1: СУВОРО ЗАБОРОНЕНО `git push`**
> Ніколи, ні за яких умов не виконуйте команду `git push`, не налаштовуйте віддалені пуші і не надсилайте дані у віддалені репозиторії! Усі коміти мають бути виключно **локальними** (`git commit -m "..."`).

> [!CAUTION]
> **ПРАВИЛО 2: НІКОЛИ НЕ ВИМИКАТИ ТА НЕ ПЕРЕЗАВАНТАЖУВАТИ ПК**
> Категорично заборонено виконувати `reboot`, `shutdown`, `poweroff`, `systemctl reboot`, `loginctl terminate-session` або будь-які операції, що вимикають комп'ютер чи завершують графічний сеанс користувача. Тестування проводиться виключно через D-Bus, eval-helper та безперервні сесійні інструменти.

> [!CAUTION]
> **ПРАВИЛО 3: БЕЗПЕКА GIT ТА ЗБЕРЕЖЕННЯ ДАНИХ**
> Заборонено використовувати деструктивні операції `git reset --hard`, `git clean -fd` або видаляти невідстежувані користувацькі файли. Усі користувацькі зміни повинні акуратно зберігатися.

> [!CAUTION]
> **ПРАВИЛО 4: НІКОЛИ НЕ ЧІПАТИ ТА НЕ КОМІТИТИ GRUB PNG-ІКОНКИ**
> Каталоги `grub/apple-mac/icons/`, `grub/apple-mac-usb/icons/`, `grub/apple-mac-usb2/icons/` містять специфічні графічні ресурси. **Ніколи не додавайте їх у `git add`** і не модифікуйте без прямої вимоги користувача.

> [!IMPORTANT]
> **ПРАВИЛО 5: МОВА СПІЛКУВАННЯ ТА ЖУРНАЛІВ — ВИКЛЮЧНО УКРАЇНСЬКА**
> Усі відповіді користувачеві в чаті, коментарі до коду, описи комітів та звіти у файлі `done.txt` ведуться **суворо українською мовою**.

> [!IMPORTANT]
> **ПРАВИЛО 6: ЮРИДИЧНА ЧИСТОТА ТА ВІДСУТНІСТЬ ТОРГОВИХ МАРОК**
> Заборонено використовувати чужі фірмові назви (зокрема «macOS», «Apple HIG» тощо) у нових файлах чи назвах компонентів. Використовуйте нейтральні загальні позначення: `macW1Y`, `default`, `System`, `Tahoe Environment`. Шрифти позначаються аліасом `default`.

> [!IMPORTANT]
> **ПРАВИЛО 7: ОБОВ'ЯЗКОВІ КЛІКАБЕЛЬНІ ПОСИЛАННЯ `file://`**
> Кожен згаданий у вашій відповіді файл, каталог, клас або звіт **МУСИТЬ** бути оформлений як клікабельне markdown-посилання формату GitHub із протоколом `file://`, наприклад:
> - [`libmac_settings.c`](file:///home/vitaliy/MACTHEMEFILES/control-center/libmac_settings.c)
> - [`macAnimationCache.js`](file:///home/vitaliy/MACTHEMEFILES/extensions/eval-helper@mactheme/macAnimationCache.js)
> - [`layout.js`](file:///home/vitaliy/MACTHEMEFILES/gnome-shell-overlay/ui/layout.js)
> - [`done.txt`](file:///home/vitaliy/MACTHEMEFILES/done.txt)

---

## 2. Ключова архітектура macW1Y

### 2.1. Рушій анімацій та кешування (`MacAnimationCache`)
- Файл: [`extensions/eval-helper@mactheme/macAnimationCache.js`](file:///home/vitaliy/MACTHEMEFILES/extensions/eval-helper@mactheme/macAnimationCache.js)
- Ліміт пам'яті: 64 MB VRAM/RAM.
- Автоматична інвалідація при зміні конфігурації моніторів або тем.
- Перевірка через CLI: [`/usr/local/bin/mac-animation-diag`](file:///home/vitaliy/MACTHEMEFILES/bin/mac-animation-diag).

### 2.2. Запуск та паралельний бар'єр (`layout.js`)
- Файл: [`gnome-shell-overlay/ui/layout.js`](file:///home/vitaliy/MACTHEMEFILES/gnome-shell-overlay/ui/layout.js)
- Системне дзеркало: `/usr/share/mactheme/gnome-shell-overlay/ui/layout.js`.
- Паралельне опитування розширень, доку та віджетів із тайм-аутом `Promise.race` у 1200 мс.
- Тривалість reveal-анімації стільниці: 380 мс.

### 2.3. Бібліотека інжекцій Параметрів (`libmac_settings.so`)
- Джерело: [`control-center/libmac_settings.c`](file:///home/vitaliy/MACTHEMEFILES/control-center/libmac_settings.c)
- Компіляція: `gcc -shared -fPIC -O2 -o control-center/libmac_settings.so control-center/libmac_settings.c $(pkg-config --cflags --libs glib-2.0 gio-2.0 json-glib-1.0 gtk4 libadwaita-1) -ldl -lm`
- Усі 5 розташувань мають бути синхронізовані через `bin/mac-audit-sync apply`.

---

## 3. Обов'язковий чек-лист валідації перед завершенням завдання

Кожне завдання вважається завершеним тільки тоді, коли всі чотири перевірки дають 100% успіху:
1. `bin/test-macw1y-animations.py` -> 12/12 PASS (100.0%)
2. `bin/mac-audit-sync check` -> 100% PASS
3. `bin/mac-i18n-verify` -> 100% SUCCESS
4. `python3 bin/mac-extension-guard verify` -> VERIFICATION SUCCESS (21/21)
