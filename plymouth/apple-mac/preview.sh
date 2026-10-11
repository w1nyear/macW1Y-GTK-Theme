#!/bin/bash

# ==============================================================================
# Apple macOS Boot Splash Preview
# Tests theme in a desktop window without rebooting
# ==============================================================================

if [ "$(id -u)" -ne 0 ]; then
    echo "❌ Для тестування потрібні права root."
    echo "Будь ласка, запустіть:"
    echo "   sudo bash $0"
    exit 1
fi

if ! dpkg -l | grep -q "plymouth-x11"; then
    echo "📦 Встановлення plymouth-x11 для віконного передперегляду..."
    apt-get update -qq && apt-get install -y plymouth-x11
fi

echo "🍎 Запуск попереднього перегляду екрану завантаження macOS (10 секунд)..."
plymouthd --debug --no-daemon &
DAEMON_PID=$!
sleep 0.5

plymouth --show-splash

# Імітація плавного завантаження системи
for i in $(seq 1 100); do
    plymouth system-update --progress=$i
    sleep 0.05
done

sleep 1
plymouth --quit
kill $DAEMON_PID 2>/dev/null || true
echo "✅ Тест завершено."
