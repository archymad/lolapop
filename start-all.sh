#!/bin/bash

# Script de démarrage pour Linux/Mac
# Bot Conversationnel Lola

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

clear

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║            Bot Conversationnel Lola - Démarrage                 ║"
echo "║                                                                ║"
echo "║    Ce script va démarrer l'interface d'administration          ║"
echo "║    Vous pourrez ensuite configurer et démarrer le bot          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo

# Vérification des prérequis
echo -e "${YELLOW}[1/5] Vérification des prérequis...${NC}"
echo

# Vérifier Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}[ERREUR] Node.js n'est pas installé.${NC}"
    echo
    echo "Veuillez installer Node.js depuis https://nodejs.org/"
    echo "Version recommandée: 18.x ou supérieure"
    echo
    exit 1
else
    NODE_VERSION=$(node -v)
    echo -e "${GREEN}[✓] Node.js trouvé: $NODE_VERSION${NC}"
fi

# Vérifier Python
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
    PYTHON_VERSION=$(python3 --version)
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
    PYTHON_VERSION=$(python --version)
else
    echo -e "${RED}[ERREUR] Python n'est pas installé.${NC}"
    echo
    echo "Veuillez installer Python depuis https://www.python.org/"
    echo "Version recommandée: 3.8 ou supérieure"
    echo
    exit 1
fi
echo -e "${GREEN}[✓] Python trouvé: $PYTHON_VERSION${NC}"

# Vérifier pip
if ! command -v pip &> /dev/null && ! command -v pip3 &> /dev/null; then
    echo -e "${YELLOW}[AVERTISSEMENT] pip n'est pas trouvé dans le PATH${NC}"
    echo "Vérifiez que Python est correctement installé avec pip"
fi

# Vérifier Ollama
echo
echo -e "${YELLOW}[2/5] Vérification d'Ollama...${NC}"
if ! curl -s http://localhost:11434/api/tags &> /dev/null; then
    echo -e "${YELLOW}[AVERTISSEMENT] Ollama n'est pas en cours d'exécution.${NC}"
    echo
    echo "Pour utiliser les fonctionnalités IA, lancez Ollama dans une autre fenêtre:"
    echo "   ollama serve"
    echo
    read -p "Voulez-vous continuer sans Ollama? (O/N) " CONTINUE_WITHOUT_OLLAMA
    if [[ ! "$CONTINUE_WITHOUT_OLLAMA" =~ ^[Oo]$ ]]; then
        exit 1
    fi
else
    echo -e "${GREEN}[✓] Ollama est en cours d'exécution${NC}"
fi

# Vérifier les dépendances Node.js
echo
echo -e "${YELLOW}[3/5] Vérification des dépendances Node.js...${NC}"
if [ ! -d "node_modules" ]; then
    echo "Installation des dépendances Node.js..."
    npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}[ERREUR] Échec de l'installation des dépendances Node.js${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}[✓] Dépendances Node.js présentes${NC}"
fi

# Vérifier les dépendances Python
echo
echo -e "${YELLOW}[4/5] Vérification des dépendances Python...${NC}"
if [ -f "ai/requirements.txt" ]; then
    echo "Installation des dépendances Python..."
    cd ai
    $PYTHON_CMD -m pip install -r requirements.txt &> /dev/null
    if [ $? -ne 0 ]; then
        echo -e "${YELLOW}[AVERTISSEMENT] Certaines dépendances Python n'ont pas pu être installées${NC}"
    else
        echo -e "${GREEN}[✓] Dépendances Python installées${NC}"
    fi
    cd ..
else
    echo -e "${YELLOW}[AVERTISSEMENT] Fichier requirements.txt non trouvé${NC}"
fi

# Initialiser les configurations si nécessaire
echo
echo -e "${YELLOW}[5/5] Initialisation des configurations...${NC}"
if [ ! -d "config" ]; then
    echo "Création des dossiers de configuration..."
    mkdir -p config schemas logs sessions
    
    echo "Exécution du script d'initialisation..."
    node init.js
    if [ $? -ne 0 ]; then
        echo -e "${RED}[ERREUR] Échec de l'initialisation${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}[✓] Dossiers de configuration présents${NC}"
fi

# Créer le fichier .env s'il n'existe pas
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo "Création du fichier .env..."
        cp .env.example .env
        echo -e "${GREEN}[✓] Fichier .env créé${NC}"
    else
        echo -e "${YELLOW}[AVERTISSEMENT] Fichier .env.example non trouvé${NC}"
    fi
fi

# Rendre le script exécutable
chmod +x start-all.sh

# Démarrer l'orchestrateur
echo
echo "════════════════════════════════════════════════════════════════"
echo
echo -e "${BLUE}[INFO] Démarrage du système...${NC}"
echo
echo "1. L'interface d'administration va s'ouvrir dans votre navigateur"
echo "2. Configurez les paramètres du bot"
echo "3. Cliquez sur \"Démarrer le Bot\" pour lancer le bot WhatsApp"
echo "4. Les logs s'afficheront en temps réel dans l'interface"
echo
echo "Pour arrêter le système, appuyez sur Ctrl+C"
echo
echo "════════════════════════════════════════════════════════════════"
echo

# Définir l'environnement
export NODE_ENV=development
export FLASK_PORT=5000
export ADMIN_PORT=3000

# Démarrer l'orchestrateur
node orchestrator.js

# Si l'orchestrateur se termine, afficher un message
echo
echo -e "${BLUE}[INFO] Le système s'est arrêté.${NC}"
echo