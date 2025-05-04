# Créer ou mettre à jour le README
echo "# LolaBot - Chatbot conversationnel WhatsApp" > README.md
echo "Bot conversationnel intelligent utilisant WhatsApp, Ollama et une architecture modulaire." >> README.md
echo "" >> README.md
echo "## Installation" >> README.md
echo "1. Cloner le repository" >> README.md
echo "2. Installer les dépendances : npm install" >> README.md
echo "3. Configurer .env" >> README.md
echo "4. Démarrer : npm run start:all" >> README.md

# Ajouter au commit
git add README.md
git commit -m "Add README"
git push