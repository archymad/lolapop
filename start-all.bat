@echo off
title Bot Conversationnel - Démarrage complet

echo ========================================
echo   Démarrage du bot conversationnel
echo ========================================
echo.

REM Vérifier si Node.js est installé
WHERE node >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    echo [ERREUR] Node.js n'est pas installé.
    echo Veuillez installer Node.js depuis https://nodejs.org/
    pause
    exit /b 1
)

REM Vérifier si Python est installé
WHERE python >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    echo [ERREUR] Python n'est pas installé.
    echo Veuillez installer Python depuis https://www.python.org/
    pause
    exit /b 1
)

REM Vérifier si Ollama est déjà en cours d'exécution
echo Vérification d'Ollama...
curl -s http://localhost:11434/api/version >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    echo [INFO] Ollama n'est pas en cours d'exécution.
    echo Veuillez lancer Ollama dans une autre fenêtre avec la commande:
    echo   ollama serve
    echo.
    echo Appuyez sur une touche lorsque Ollama est démarré...
    pause >nul
)

echo [INFO] Installation des dépendances...
call npm install

echo [INFO] Initialisation du système...
call node init.js

echo.
echo [INFO] Démarrage du système...
echo.
echo 1. Interface d'administration: http://localhost:3000
echo 2. Pour scanner le QR code WhatsApp, utilisez la fenêtre du bot
echo.
echo [INFO] Pour arrêter le système, fermez toutes les fenêtres et
echo        appuyez sur Ctrl+C dans chaque console.
echo.

REM Démarrer tous les composants
call npm run start:all

pause