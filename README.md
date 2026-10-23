# macW1Y - macOS like Gnome

[![Ubuntu](https://img.shields.io/badge/Ubuntu-E95420?style=for-the-badge&logo=ubuntu&logoColor=white)](https://ubuntu.com/)
[![GNOME](https://img.shields.io/badge/GNOME-4a86cf?style=for-the-badge&logo=gnome&logoColor=white)](https://www.gnome.org/)
[![w1nyear](https://img.shields.io/badge/w1nyear-blue?style=for-the-badge)](https://github.com/w1nyear)

---

<p align="center">
  <img src="screen.MOV" alt="macW1Y Desktop Preview" width="100%" />
</p>

---

macW1Y — це повний набір тем, розширень та системних налаштувань для перетворення Ubuntu (GNOME Shell на Wayland) на macOS. Проєкт включає GTK3/GTK4 теми, GNOME Shell тему, іконки, шрифти SF Pro, анімований GRUB та Plymouth, демон жестів тачпада, оптимізації продуктивності для гібридної графіки та багато іншого.

### Вигляд

Система отримує зовнішній вигляд macOS: верхня панель з центром керування стилю macOS, док з рідким склом (Liquid Glass), Mission Control замість стандартного огляду GNOME, центр повідомлень з боку, а також Finder-подібна бічна панель у Nautilus. Кольорова схема, радіуси заокруглень, тіні, анімації та типографіка максимально наближені до macOS Sequoia/Tahoe. Доступні темні та світлі варіанти тем.

---

## Структура проєкту

```
macW1Y/
├── install.sh                    # Головний автоматизований інсталятор
├── uninstall.sh                  # Деінсталятор для повернення стандарту Ubuntu Yaru
├── README.md                     # Ця документація
├── LICENSE                       # Ліцензія GPLv3
├── done.txt                      # Журнал розробки та виконаних завдань
├── screen.webp                   # Знімок екрану робочого столу
├── 99-cpu-power.rules            # Udev правила управління живленням CPU
├── 99-zram.conf                  # Налаштування zRAM
├── cpu-power-manager             # Скрипт управління потужністю CPU
├── cpu-power-manager.service     # Systemd сервіс CPU power manager
├── apply_plymouth.sh             # Скрипт застосування Plymouth теми
├── toggle-launchpad.sh           # Перемикач Launchpad
├── macW1Y-Dark/                  # Темна тема GTK3, GTK4, Shell
├── macW1Y-Dark-solid/            # Суцільна версія темної теми
├── macW1Y-Light/                 # Світла тема GTK3, GTK4, Shell
├── macW1Y-Light-solid/           # Суцільна версія світлої теми
├── gnome-shell-theme/            # Кастомний CSS GNOME Shell
├── icons/                        # Набори іконок macW1Y
├── fonts/                        # 29 шрифтів Apple SF Pro
├── wallpapers/                   # Фірмові шпалери macOS
├── bin/                          # Системні скрипти та утиліти
├── lib/                          # Скомпільовані бінарні бібліотеки
├── src/                          # Вихідний код C для розширень
├── applications/                 # Додаткові .desktop лаунчери
├── autostart/                    # Автозапуск служб
├── extensions/                   # Налаштовані компоненти GNOME Shell
│   ├── blur-my-shell@aunetx      # Розмиття меню-бару та робочого простору
│   ├── liquid-glass@thinkingcoding1231.gmail.com  # Динамічний шейдер рідкого скла
│   ├── eval-helper@mactheme      # Фоновий GC, Focus Stealer, DBus-міст
│   ├── kiwi@kemma                # Control Center, Notification Center, тощо
│   ├── wack-system               # Lockscreen clock та анімації
│   ├── cupertino-dock-lite@rinzler69-wastaken.github.com  # Док macOS стилю
│   └── ...                       # Інші розширення
├── control-center/               # Компоненти Центру керування
├── grub/                         # GRUB тема Apple Silicon стилю
├── plymouth/                     # Plymouth тема анімації Apple логотипу
├── macos-plymouth/               # Альтернативна Plymouth тема
├── macos-gdm/                    # GDM тема стилю macOS
├── systemd/                      # Systemd юніти (cpu-power-manager, mac-gamemode)
├── dconf/                        # Конфігураційні дампи середовища
├── dependencies/                 # Списки залежностей та скрипти встановлення
├── config/                       # GTK3/GTK4 конфігурації
├── gtk-3.0/                      # GTK3 теми користувача
├── gtk-4.0/                      # GTK4 теми користувача
├── themes/                       # Додаткові варіації тем
├── sounds/                       # Системні звуки macOS
├── touchpad/                     # Демон жестів тачпада
├── wack-system/                  # Lockscreen система
└── assets/                       # Графічні асети
```

---

## Системні вимоги

### Мінімальні
- **ОЗУ:** 2 ГБ
- **Відео:** Intel UHD Graphics / AMD Radeon Vega / NVIDIA GT 1030
- **ОС:** Ubuntu 24.04 LTS (GNOME 46+ на Wayland)
- **Диск:** 10 ГБ вільного місця
- **Процесор:** 2 ядра x86_64
- **Secure Boot:** Вимкнено (для підпису модулів ядра)

### Рекомендовані
- **ОЗУ:** 4 ГБ або більше
- **Відео:** Гібридна графіка Intel + NVIDIA (RTX 3050/4050/4060) або AMD Radeon RX 6000/7000 серії
- **ОС:** Ubuntu 26.04 LTS (GNOME 48+ на Wayland)
- **Диск:** 20 ГБ вільного місця (SSD NVMe)
- **Процесор:** Intel Core i5 12/13/14 покоління (P-cores + E-cores) або AMD Ryzen 5000/7000/9000 серії
- **Secure Boot:** Вимкнено
- **BIOS/UEFI:** Сучасна версія з підтримкою Resizable BAR

---

## Встановлення

```bash
git clone https://github.com/w1nyear/macW1Y-GTK-Theme.git macW1Y
cd macW1Y
chmod +x install.sh
./install.sh
```

### Варіанти запуску

**Інтерактивне встановлення / Оновлення:**
```bash
chmod +x install.sh
./install.sh
```

**Повне автоматичне встановлення всіх компонентів:**
```bash
chmod +x install.sh
./install.sh --all
```

> **Примітка:** Після завершення встановлення виконайте перезавантаження комп'ютера (`sudo reboot`) або вийдіть із сесії, щоб усі апаратні модулі, правила udev, zRAM та розмиття вікон запрацювали на повну потужність.

---

## Деінсталяція

```bash
cd macW1Y
chmod +x uninstall.sh
./uninstall.sh
```

Деінсталятор повертає стандартну тему Yaru, видаляє всі встановлені розширення, системні сервіси, udev правила, GRUB та Plymouth теми, а також очищає конфігураційні файли користувача.

---

## Подяки

- **Lilithium** — за розширення blur-my-shell та технічну підтримку
- **Teemo** — за розширення liquid-glass та шейдери рідкого скла

---

## Ліцензія та авторство

**Автор та розробник модпака macW1Y:** Vitaliy (w1nyear)

**Ліцензія:** GNU General Public License v3.0 (GPLv3). Повний текст ліцензії дивіться у файлі [LICENSE](LICENSE).

**Правова інформація:**
- Проєкт розроблено в освітніх та естетичних цілях для користувачів Linux
- Торгові марки Apple, macOS, San Francisco, Sequoia, Tahoe є власністю Apple Inc.
- Усі базові компоненти з відкритим кодом ліцензовано відповідно до ліцензій їхніх авторів (GPL, MIT, LGPL, Apache 2.0)
- Шрифти SF Pro використовуються виключно для особистого некомерційного використання
- Код розширень GNOME Shell базується на API GNOME та поширюється під ліцензією GPLv3+

---

**Офіційний репозиторій:** https://github.com/w1nyear/macW1Y-GTK-Theme

**Версія:** 0.3
