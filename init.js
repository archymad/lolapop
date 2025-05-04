/**
 * Script d'initialisation du bot
 * Crée les dossiers et fichiers de configuration initiaux
 */

const fs = require('fs');
const path = require('path');
const configurator = require('./configurator');

async function initialize() {
  console.log('Initialisation du système de bot conversationnel...');
  
  // Créer les dossiers nécessaires
  const directories = [
    'config',
    'schemas',
    'sessions',
    'logs',
    'public',
    'assets'
  ];
  
  for (const dir of directories) {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) {
      console.log(`Création du dossier: ${dir}`);
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
  
  // Initialiser le configurateur
  await configurator.initialize();
  
  // Vérifier si les configurations existent déjà
  const configs = ['bot', 'personality', 'scenario', 'ai', 'media', 'geo'];
  let configsMissing = false;
  
  for (const config of configs) {
    try {
      configurator.getConfig(config);
    } catch (error) {
      configsMissing = true;
      console.log(`Configuration manquante: ${config}`);
    }
  }
  
  if (configsMissing) {
    console.log('Création des configurations par défaut...');
    
    // Chargement des configurations par défaut
    const defaultConfigs = loadDefaultConfigs();
    
    // Enregistrement des configurations
    for (const [key, config] of Object.entries(defaultConfigs)) {
      configurator.mergeConfig(key, config);
      await configurator.saveConfig(key);
    }
    
    console.log('Configurations par défaut créées.');
  }
  
  console.log('Initialisation terminée.');
  console.log('Vous pouvez maintenant démarrer le bot avec:');
  console.log('  npm run start:all');
}

function loadDefaultConfigs() {
  return {
    // Charger les configurations depuis les fichiers par défaut
    bot: require('./config/bot.config.json'),
    personality: require('./config/personality.json'),
    scenario: require('./config/scenario.json'),
    ai: require('./config/ai.config.json'),
    media: require('./config/media.config.json'),
    geo: { 
      // Configuration géographique minimaliste
      "Paris": ["Ivry", "Montreuil", "Clichy"],
      "Lyon": ["Villeurbanne", "Bron", "Caluire-et-Cuire"]
    }
  };
}

// Exécuter l'initialisation
initialize().catch(error => {
  console.error('Erreur lors de l\'initialisation:', error);
  process.exit(1);
});