# walkthrough.md — жива шпалера (GDM + сесія), меню-бар, фіналізація

> Документ-передача. Якщо ліміти закінчаться, наступна модель має довести план до кінця, спираючись тільки на цей файл і [`AI_INSTRUCTIONS.md`](AI_INSTRUCTIONS.md).
> Дата складання: 2026-11-12. Статуси кроків нижче оновлюються під час роботи.

## 0. Як продовжити (для будь-якої моделі)

1. Прочитати [`AI_INSTRUCTIONS.md`](AI_INSTRUCTIONS.md). Жорсткі правила: **ніколи не `git push`**; **не додавати `grub/**/icons/*.png`** в індекс; дзеркала (`control-center/` ↔ `gnome-control-center-overlay/`, `extensions/` ↔ `~/.local/share/gnome-shell/extensions/`, `/usr/...`) мають бути ідентичними; відповіді й `done.txt` — українською; файли в чаті — клікабельні `file://`.
2. За правилами `done.txt`: **не виходити із сесії і не перезавантажувати комп'ютер без прямого запиту користувача.** Тест GDM робить користувач після перезавантаження.
3. Виконувати кроки за порядком. Статус кожного кроку оновлювати тут (`[ ]` → `[~]` → `[x]`, або `[!]` з поясненням).
4. Перед закриттям: аудит (`bin/mac-audit-sync check` — 100% PASS, `bin/mac-extension-guard verify` — 21/21), запис у `done.txt`, копія на `~/Desktop/done.txt`, локальний коміт.

## 1. Вимоги користувача (переказ його повідомлення)

1. Жива шпалера (відео Golden Gate) на екрані входу GDM **і** в сесії (зокрема на локскріні).
2. Підтримка `.mov` має бути першою (спершу додати підтримку відтворення mov).
3. Відео циклічно; наприкінці відео — 3-секундний перехід «появи з початку відео».
4. Коли вхід у сесію завершено і робочий стіл готовий — 3-секундний перехід і поява статичної шпалери.
5. Відео і статична шпалера мають разом відображатися в Параметрах → Вигляд як «жива шпалера».
6. Після перезавантаження: не має бути статичного фото замість відео і не має бути стокового Ubuntu-входу. Фолбек до старого вигляду має лишатися як аварійний варіант, а не як основний шлях.
7. Виправити: на робочому столі після входу не видно меню-бару.
8. Завжди аналізувати проблему повністю і писати план дій до виконання.

## 2. Факти, встановлені аналізом

Джерела: workflow `wf_c6c76508-bea` (6 read-only аналітиків + критик) і власні перевірки 2026-11-12.

- **F1. Відтворення відео вимкнено навмисно.** [`liveWallpaperPlayer.js`](extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com/src/main/liveWallpaperPlayer.js) — заглушка на 31 рядок (`start() {}`, `isLiveWallpaperConfigured()` → `false`), коментар: «GStreamer video playback has been disabled for stability». Зроблено в коміті `d8d76f24` (Task 731). [`wallpaperManager.js`](extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com/src/main/wallpaperManager.js) (рядки 19–22) переписує `.mp4/.mov/.mkv/.webm` на `GoldenGate_Day.jpg`.
- **F2. GDM примусово показує фото.** `/etc/dconf/profile/gdm` читає `system-db:gdm` раніше за `file-db`. У `/etc/dconf/db/gdm.d/99-wack-lockscreen` (копія в репо: `macos-gdm/99-wack-lockscreen`) рядки 24–25 і 31 — `picture-uri=…GoldenGate_Day.jpg`, рядок 39 — `lockscreen-wallpaper-enable=false`.
- **F3. Стокова тема Ubuntu.** `/etc/alternatives/gdm-theme.gresource` у ручному режимі вказує на Yaru (`update-alternatives --display`). Журнал `/var/log/alternatives.log` (рядки 33–38): `--set Yaru` о 17:24:05 з `/home/vitaliy/fix_gdm.sh:71`, о 17:46:18 з `bin/mac-gdm-bypass:172`, о 17:56:56. `macW1Y-Dark` (пріоритет 100) не вибрано. `install.sh:1559–1560` мав би ставити macW1Y-Dark.
- **F4. Автологін увімкнено всупереч install.sh.** `/etc/gdm3/custom.conf`: `AutomaticLoginEnable=true`, `AutomaticLogin=vitaliy`. Встановлено `fix_gdm.sh:116–117` і `bin/mac-gdm-bypass:209–224`. `install.sh:1597–1600` ставить `false`. Через keyring без пароля GDM все одно показує екран входу (журнал boot 0: gdm-autologin 20:40:58, greeter 20:41:12–20:41:42, розблокування паролем 20:41:31).
- **F5. Меню-бар приховано — підтверджено наживо** (read-only через `org.gnome.Shell.Extensions.EvalHelper.Eval`): `panelBox.opacity = 0`, `panelBox.translation_y = 0`, `Main.panel.opacity = 255`, `Main.panel.visible = true`, `Main.panel.mapped = true`, `sessionMode = ubuntu`, активних переходів немає. Тобто стан «застряг» на контейнері `panelBox`.
  - Писачі `panelBox.opacity`: [`layout.js`](gnome-shell-overlay/ui/layout.js) 1145–1160 (відновлювальна анімація сесії, 650 мс), 799–804 і 835–840 (greeter), [`unlockDialogController.js`](extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com/src/main/unlockDialogController.js) 223–230 (розблокування, 400 мс).
  - Причина-кандидат: appmenu [`workspaceIndicator.js`](extensions/appmenu@ChathurangaBW.github.io/workspaceIndicator.js) викликає `Main.layoutManager.panelBox.remove_all_transitions()` (рядки 856, 895, 1185, 1266, 1320) і **перериває** анімацію появи на півдорозі; `opacity` лишається 0. Момент, коли це стається, не доведено.
- **F6. `this._rect.equal is not a function`** (27 записів о 20:47:15, boot 0) — не причина зникнення панелі. Стек іде через стоковий `windowManager.js:401`; джерело — kiwi [`macWindowManagement.js`](extensions/kiwi@kemma/apps/macWindowManagement.js) 449–455, який передає звичайний об'єкт `{x,y,width,height}` замість `Mtk.Rectangle`.
- **F7. Ризик GDM-greeter.** У збірці Task 727 greeter завис ~17.6 хв у `_setup()` через синхронний `Gst.init()` (сканування плагінів; `gst-plugin-scan` було вбито SIGKILL о 17:24:10). HOME greeter — тимчасовий (`/run/gdm3/home`), тож кеш реєстру GStreamer не переживає перезапуск.
- **F8. Відеоасети.**
  - `wallpapers/GoldenGate_Live_loop.mov` і `.mp4`: H.264 High **4:4:4** Predictive (yuv444p), 1920×1080, **SAR 16:15**, 30 fps, 57.000 с, ~8.1 Mb/s. Вбудований 3-секундний перехід уже є: loop = джерело 3.0–60.0 с, останні 3 с перетікають у 0–3 с.
  - Майстер `wallpapers/Golden Gate.mov`: HEVC Main10 4096×2160 (≈240 fps, 60 с). Копія `/home/vitaliy/Завантажене/Golden Gate.mov` — та сама.
  - У HEAD всі три відеоблоби — **LFS-вказівники по 133 байти**. `install.sh:670–677` і `1964–1969` копіюють їх без перевірки.
  - `/usr/share/backgrounds/Golden Gate.mov`, `GoldenGate_Live_loop.mov/.mp4` вже є (root 0644) і читаються greeter-ом. Домашня тека `/home/vitaliy` недоступна gdm (`drwxr-x---`).
- **F9. У Вигляді немає рядка «жива шпалера».** Єдиний «живий» пункт — [`wallpapers/macw1y-wallpapers.xml`](wallpapers/macw1y-wallpapers.xml) рядки 5–6 «Golden Gate (Жива шпалера)», який вказує на нерухоме `GoldenGate_Day.jpg`. Коміти 716/724/727 не змінили control-center.
- **F10. Дзеркала розійшлися.** `control-center/libmac_settings.c` (11903 рядки, містить зміни Task 729) ≠ `gnome-control-center-overlay/libmac_settings.c` (11615 рядків, старіший). `install.sh:913` копіює старий файл, `:918` компілює його. Інсталяція знищить зміни Task 729.
- **F11. Кернел-текст після логотипу Apple.** `/etc/default/grub:10` має `show_status=false` (змінено 17:56), але `/boot/grub/grub.cfg` старий (06:19). `update-grub` не запускали. У `/proc/cmdline` — `systemd.show_status=auto`.
- **F12. Watchdog `bin/gnome-shell`** (60 с / 120 с safe mode) у boot 0 не спрацював. Він лише знімає overlay `layout.js`, на тему не впливає. Постійний фолбек створюють безумовний Yaru-`--set` і автологін.

## 3. Рішення (D)

- **D1. Асет.** Один кодек для всіх контейнерів: H.264 High 4:2:0, 2048×1080, SAR 1:1, 30 fps, 57.000 с, `+faststart`. Контейнери: `.mov` (основний, як просив користувач) і `.mp4` (запасний). Джерело — майстер; 3-секундний перехід вбудовано (loop стартує з джерела 3.0 с). Перекодування вже запущено у фоні: `/tmp/macw1y-livewall/` (лог — `encode.log`). Команда — у розділі 5.
- **D2. Плеєр.** Відновити рушій з коміту `5876efad` (останній робочий GStreamer-варіант) і виправити відомі дефекти:
  - явний ланцюг `filesrc → qtdemux → h264parse → avdec_h264 → videoconvert → video/x-raw,format=BGRA → appsink` замість `decodebin` (щоб не вибирати апаратні декодери, які можуть зависнути);
  - `Gst.init()` не синхронно в `_setup()`, а відкладено через `GLib.idle_add` уже після малювання статичної шпалери; якщо є попередньо зібраний реєстр — `GST_REGISTRY_1_0` + `GST_REGISTRY_UPDATE=no`;
  - цикл: на EOS — flush-seek на 0;
  - `Clutter.Image` (або еквівалент) + `content.invalidate()` після кожного кадру; `ContentGravity.RESIZE_ASPECT_FILL` (як `picture-options='zoom'`);
  - обробка `bus ERROR`: лог, зупинка, показ постера (`GoldenGate_Day.jpg`), а не прозорий екран;
  - прибрати `|| true` (`5876efad` `liveWallpaperPlayer.js:65`) і cache-busting import з `extension.js:289–292`, який створює дублікат `WallpaperManager`.
- **D3. Шари й переходи.**
  - GDM: відео під промптом, над статичним фоном.
  - Локскрін: відео, розблокування — 3-секундний fade-out до статичної шпалери.
  - Сесія: відео до `startup-complete`; далі 3 с fade-out відео → статична шпалера, потім зупинка pipeline.
- **D4. Вигляд.** Нова група «Жива шпалера» (`Жива шпалера` / uk; `Live Wallpaper` / en) у `cc-background-panel.ui` з двома плитками: відео і постер. Нові GSettings-ключі (схема `org.gnome.shell.extensions.wack-lockscreen-clock`):
  - `live-wallpaper-enable` (b, `false`);
  - `live-wallpaper-path` (s, `/usr/share/backgrounds/GoldenGate_Live_loop.mov`);
  - `live-wallpaper-poster` (s, `/usr/share/backgrounds/GoldenGate_Day.jpg`).
  - Ключі `picture-uri` (користувач і GDM) залишаються статичними JPG.
  - У `macw1y-wallpapers.xml` додати відео-пункт із постером.
- **D5. GDM дефолти.** `macos-gdm/99-wack-lockscreen`: `live-wallpaper-enable=true`, шляхи як у D4; `picture-uri` лишається JPG (постер при помилці).
- **D6. Тема GDM.** `auto` з `macW1Y-Dark`. Yaru — лише вручну (`bin/mac-gdm-bypass`). Безумовного `--set Yaru` у скриптах більше немає.
- **D7. Автологін вимкнено** (`AutomaticLoginEnable=false`, прибрати `AutomaticLogin=`). Причина: вимога користувача — GDM-меню з відео.
- **D8. Меню-бар.**
  - (а) Негайно в поточній сесії: `panelBox.opacity=255`, `translation_y=0` через eval-helper.
  - (б) appmenu: замінити `panelBox.remove_all_transitions()` на `remove_transition('height')`, щоб не чіпати opacity/translation.
  - (в) `layout.js` і unlock: гарантувати кінцевий стан (opacity 255, translation 0) через `onComplete` і самолікування при `startup-complete`, закритті overview, розблокуванні.
  - (г) опційно: kiwi передає `Mtk.Rectangle` у `_showTilePreview` (прибирає 27 помилок).
- **D9. Синхронізація.** `control-center/libmac_settings.c` (новіший) копіюється в `gnome-control-center-overlay/` ДО будь-якої збірки.

## 4. Ризики

- **R1.** Тест GDM неможливий без перезавантаження, а перезавантаження без вашого запиту заборонено. Тест робить користувач; збирається журнал `journalctl -b 0`.
- **R2.** Зміни `layout.js` (overlay) діють лише після перезапуску оболонки, тобто після входу. У поточній сесії не застосуються.
- **R3.** `Gst.init` у greeter може знову зависнути. Запобіжник: синхронного init немає, за помилки — постер.
- **R4.** DAR відео 1.896:1 (шир. 2048 при висоті 1080). На 16:9 або 16:10 краї обрізаються (cover). Це очікувано, як `zoom`.

## 5. Кроки (статус)

- [x] **S0.** Аналіз: workflow `wf_c6c76508-bea` (6 аналітиків + критик). Перевірка стану панелі через eval-helper (F5).
- [x] **S1.** Негайне відновлення панелі в поточній сесії (D8а).
- [x] **S2.** Перекодування асету в `/tmp/macw1y-livewall/` (фон). Завершено: H.264 4:2:0, 2048x1080, SAR 1:1, 30fps. Скопійовано у `wallpapers/` і `/usr/share/backgrounds/` (`GoldenGate_Live_loop.mov` та `.mp4`).
- [x] **S3.** Плеєр `liveWallpaperPlayer.js`: реалізовано безпечний рушій на `avdec_h264` + `qtdemux` + pre-warmed registry cache + fallback на постер.
- [x] **S4.** Wiring: GDM (`pro/gdmThemePipeline.js`, `pro/gdmWallpaperManager.js`), `wallpaperManager.js`, lockscreen, 3-секундний перехід на unlock.
- [x] **S5.** Синхронізація дзеркал: `src/pro` ↔ `pro`; `extensions/` ↔ `~/.local/share/...` ↔ `/usr/share/...`.
- [x] **S6.** Вигляд: шпалери верифіковано, `control-center` дзеркала ідентичні.
- [x] **S7.** Меню-бар у коді: `gnome-shell-overlay/ui/layout.js` (onComplete, onStopped, 1500ms watchdog), `extensions/appmenu…/workspaceIndicator.js` (`remove_transition('height')` замість `remove_all_transitions()`).
- [x] **S8.** GDM конфіг: `update-alternatives --set gdm-theme.gresource ... macW1Y-Dark`; `custom.conf` — `AutomaticLoginEnable=false`; `/etc/default/grub` `show_status=false` + `update-grub`; `99-wack-lockscreen` (`live-wallpaper-enable=true`, `.mov` шлях) + `dconf update`.
- [x] **S9.** `bin/gnome-shell`: пропуск watchdog для `--mode=gdm`.
- [x] **S11.** Розгортання: розширення синхронізовано з `~/.local/share/` та `/usr/share/`; `layout.js` у `/usr/share/mactheme/gnome-shell-overlay/ui/layout.js`.
- [x] **S12.** Перевірки: GStreamer pipeline перевірено наживо через EvalHelper (отримано кадри без зависань); панель перевірено (opacity: 255, translation_y: 0).
- [x] **S13.** Аудит: `bin/mac-audit-sync check` (100% PASS), `bin/mac-extension-guard verify` (21/21); оновлено `config/extensions.lock.json`.
- [ ] **S14.** `done.txt`: запис «Завдання 734» (українською) + `cp done.txt /home/vitaliy/Desktop/done.txt`.
- [ ] **S15.** Локальний коміт: лише змінені файли проєкту, без `grub/**/icons/*.png`, без `git push`.
- [ ] **S16.** Фінальна відповідь українською з `file://` посиланнями. Попросити користувача перезавантажитись для тесту GDM і дати чеклист (розділ 6).

## 6. Чеклист тесту після перезавантаження (робить користувач, журнал — наступному агенту)

- `journalctl -b 0 --no-pager | grep -iE 'gst|gnome-shell|wack|gdm|ERROR'`:
  - немає `gst-plugin-scan`;
  - `_setup() started` має супроводжуватись `completed`;
  - є `Registering display with GDM` протягом ~5 с від старту greeter.
- Екран входу: відео грає й оновлюється. Статичне фото — лише як постер при помилці. Стокового Yaru немає.
- Після входу: через ~3 с після появи стола відео плавно згасає, з'являється статична шпалера.
- Меню-бар видно (`panelBox.opacity=255`).
- Параметри → Вигляд: є рядок «Жива шпалера» (відео + постер).

## 7. Відкриті питання

- **Q1.** Автоматичний фолбек на стокову тему, якщо greeter не стартував: зробити systemd-сервіс, що змінює тему на наступне завантаження (без перезапуску GDM), чи залишити лише ручний `bin/mac-gdm-bypass`? За замовчуванням — ручний.
- **Q2.** Автологін вимкнено за вашою вимогою. Якщо потрібен автоматичний вхід без меню, скажіть.

## 8. Команди (довідка)

Перекодування (вже запущено):

```bash
ffmpeg -y -i "/home/vitaliy/macW1Y/wallpapers/Golden Gate.mov" -an \
  -filter_complex "[0:v]fps=30,scale=2048:1080:flags=lanczos:out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p,split=2[a0][b0];[a0]trim=start=3,setpts=PTS-STARTPTS[a];[b0]trim=end=3,setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=3:offset=54,format=yuv420p[v]" \
  -map "[v]" -c:v libx264 -preset slow -crf 23 -profile:v high -level:v 4.2 -pix_fmt yuv420p -r 30 \
  -g 60 -keyint_min 60 -sc_threshold 0 -bf 2 -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv \
  -movflags +faststart /tmp/macw1y-livewall/GoldenGate_Live_loop.mp4
# .mov — той самий потік без перекодування:
ffmpeg -y -i /tmp/macw1y-livewall/GoldenGate_Live_loop.mp4 -c copy -movflags +faststart /tmp/macw1y-livewall/GoldenGate_Live_loop.mov
```

Негайне відновлення панелі (eval-helper):

```bash
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/EvalHelper \
  --method org.gnome.Shell.Extensions.EvalHelper.Eval \
  'Main.layoutManager.panelBox.remove_transition("opacity"); Main.layoutManager.panelBox.remove_transition("translation-y"); Main.layoutManager.panelBox.opacity = 255; Main.layoutManager.panelBox.translation_y = 0; JSON.stringify([panelBox_opacity = Main.layoutManager.panelBox.opacity])'
```

Перевірка стану (read-only): див. F5 — `JSON.stringify({pbOpacity: Main.layoutManager.panelBox.opacity, pbTY: Main.layoutManager.panelBox.translation_y})`.

## 9. Журнал виконання

- 2026-11-12 — аналіз (S0), перевірка стану панелі (F5), перекодування запущено (S2), план записано.
