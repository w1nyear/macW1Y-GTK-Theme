#!/usr/bin/env python3
"""Перевіряє структурні запобіжники оптимізації без запуску графічної сесії."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
FILES = {
    "animation": ROOT / "extensions/eval-helper@mactheme/macAnimationCache.js",
    "spotlight": ROOT / "extensions/appmenu@ChathurangaBW.github.io/searchDialog.js",
    "indicators": ROOT / "extensions/ubuntu-appindicators@ubuntu.com/dbusMenu.js",
    "glass": ROOT / "extensions/liquid-glass@thinkingcoding1231.gmail.com/dist/applicationManager.js",
}


def require(condition, description):
    if not condition:
        print(f"FAIL: {description}")
        return False
    print(f"PASS: {description}")
    return True


def main():
    animation = FILES["animation"].read_text(encoding="utf-8")
    spotlight = FILES["spotlight"].read_text(encoding="utf-8")
    indicators = FILES["indicators"].read_text(encoding="utf-8")
    glass = FILES["glass"].read_text(encoding="utf-8")

    checks = [
        require("Meta.LaterType.BEFORE_REDRAW" not in animation,
                "немає постійного callback перед перемальовуванням"),
        require("global.stage.connect('after-paint'" in animation,
                "вимірювання кадрів пасивне та прив'язане до фактичного малювання"),
        require("this._maxBytes = CACHE_MAX_BYTES" in animation,
                "ліміт кешу встановлюється для екземпляра рушія"),
        require("estimatedDroppedFrames" in animation and "p95FrameGapMs" in animation,
                "діагностика зберігає оцінку пропусків кадрів та p95 інтервалу"),
        require("beginUiCapture?.(component)" in spotlight,
                "Spotlight/Launchpad починають профіль вимірювання"),
        require("this._cachedStyling !== undefined" in spotlight
                and "this._interfaceSettings" in spotlight,
                "параметри файлу стилів та теми кешуються"),
        require("this._glassResolutionKey === key" in spotlight,
                "роздільність скла змінюється лише коли змінюється монітор"),
        require("const pendingItems = this._itemsBeingAdded" in indicators
                and "this._rootMenu !== rootMenu" in indicators,
                "відкладене додавання індикатора захищене від гонки з видаленням меню"),
        require("rootMenu?._getMenuItems?.()" in indicators,
                "видалення пункту меню безпечно переживає знищення кореневого меню"),
        require("this._idleFrameCount < 8" in glass,
                "рушій скла припиняє безперервний frame callback після стабілізації"),
        require("if (this._frameTicking)" in glass and "this._runFrameTick();" in glass,
                "повторне пробудження під час синхронізації скла не входить у рекурсію"),
        require("_scheduleFrameHeartbeat()" in glass and "1500" in glass,
                "для періодичної перевірки скла використовується рідкий heartbeat"),
        require("state.isDirty = true;\n                this._startFrameSync();" in glass,
                "зміни геометрії вікон будять кадри скла за подією"),
    ]
    passed = sum(checks)
    print(f"Підсумок: {passed}/{len(checks)} структурних перевірок пройдено.")
    return 0 if all(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
