@echo off
title Bot Conversationnel Lola - Interface de Démarrage

:: Définir l'encodage UTF-8 pour l'affichage correct des caractères
chcp 65001 > nul

:: Couleurs pour l'affichage
color 0E

echo.
echo ╔════════════════════════════════════════════════════════════════╗
echo ║            Bot Conversationnel Lola - Démarrage                 ║
echo ║                                                                ║
echo ║    Ce script va démarrer l'interface d'administration          ║
echo ║    Vous pourrez ensuite configurer et démarrer le bot          ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.

:: Vérification des prérequis
echo [1/5] Vérification des prérequis...
echo.

:: Vérifier Node.js
WHERE node >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    echo [ERREUR] Node.js n'est pas installé.
    echo.
    echo Veuillez installer Node.js depuis https://nodejs.org/
    echo Version recommandée: 18.x ou supérieure
    echo.
    pause
    exit /b 1
) ELSE (
    for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
    echo [✓] Node.js trouvé: %NODE_VERSION%
)

:: Vérifier Python
WHERE python >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    WHERE python3 >nul 2>nul
    IF %ERRORLEVEL% NEQ 0 (
        echo [ERREUR] Python n'est pas installé.
        echo.
        echo Veuillez installer Python depuis https://www.python.org/
        echo Version recommandée: 3.8 ou supérieure
        echo.
        pause
        exit /b 1
    ) ELSE (
        for /f "tokens=*" %%i in ('python3 --version') do set PYTHON_VERSION=%%i
        echo [✓] Python trouvé: %PYTHON_VERSION%
    )
) ELSE (
    for /f "tokens=*" %%i in ('python --version') do set PYTHON_VERSION=%%i
    echo [✓] Python trouvé: %PYTHON_VERSION%
)

:: Vérifier pip
WHERE pip >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    echo [AVERTISSEMENT] pip n'est pas trouvé dans le PATH
    echo Vérifiez que Python est correctement installé avec pip
)

:: Vérifier Ollama
echo.
echo [2/5] Vérification d'Ollama...
curl -s http://localhost:11434/api/tags >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    echo [AVERTISSEMENT] Ollama n'est pas en cours d'exécution.
    echo.
    echo Pour utiliser les fonctionnalités IA, lancez Ollama dans une autre fenêtre:
    echo    ollama serve
    echo.
    echo Voulez-vous continuer sans Ollama? (O/N)
    set /p CONTINUE_WITHOUT_OLLAMA=
    if /i "%CONTINUE_WITHOUT_OLLAMA%" neq "O" exit /b 1
) ELSE (
    echo [✓] Ollama est en cours d'exécution
)

:: Vérifier les dépendances Node.js
echo.
echo [3/5] Vérification des dépendances Node.js...
if not exist "node_modules" (
    echo Installation des dépendances Node.js...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERREUR] Échec de l'installation des dépendances Node.js
        pause
        exit /b 1
    )
) else (
    echo [✓] Dépendances Node.js présentes
)

:: Vérifier les dépendances Python
echo.
echo [4/5] Vérification des dépendances Python...
if exist "ai\requirements.txt" (
    echo Installation des dépendances Python...
    cd ai
    python -m pip install -r requirements.txt >nul 2>nul
    if %ERRORLEVEL% NEQ 0 (
        echo [AVERTISSEMENT] Certaines dépendances Python n'ont pas pu être installées
    ) else (
        echo [✓] Dépendances Python installées
    )
    cd ..
) else (
    echo [AVERTISSEMENT] Fichier requirements.txt non trouvé
)

:: Initialiser les configurations si nécessaire
echo.
echo [5/5] Initialisation des configurations...
if not exist "config" (
    echo Création des dossiers de configuration...
    mkdir config
    mkdir schemas
    mkdir logs
    mkdir sessions
    
    echo Exécution du script d'initialisation...
    call node init.js
    if %ERRORLEVEL% NEQ 0 (
        echo [ERREUR] Échec de l'initialisation
        pause
        exit /b 1
    )
) else (
    echo [✓] Dossiers de configuration présents
)

:: Créer le fichier .env s'il n'existe pas
if not exist ".env" (
    if exist ".env.example" (
        echo Création du fichier .env...
        copy .env.example .env
        echo [✓] Fichier .env créé
    ) else (
        echo [AVERTISSEMENT] Fichier .env.example non trouvé
    )
)

:: Démarrer l'orchestrateur
echo.
echo ════════════════════════════════════════════════════════════════
echo.
echo [INFO] Démarrage du système...
echo.
echo 1. L'interface d'administration va s'ouvrir dans votre navigateur
echo 2. Configurez les paramètres du bot
echo 3. Cliquez sur "Démarrer le Bot" pour lancer le bot WhatsApp
echo 4. Les logs s'afficheront en temps réel dans l'interface
echo.
echo Pour arrêter le système, fermez cette fenêtre ou appuyez sur Ctrl+C
echo.
echo ════════════════════════════════════════════════════════════════
echo.

:: Définir l'environnement
set NODE_ENV=development
set FLASK_PORT=5000
set ADMIN_PORT=3000

:: Démarrer l'orchestrateur
call node orchestrator.js

:: Si l'orchestrateur se termine, afficher un message
echo.
echo [INFO] Le système s'est arrêté.
echo.
pause