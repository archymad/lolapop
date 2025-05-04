/**
 * Interface d'administration web pour le bot conversationnel
 */

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const configurator = require('./configurator');
const fs = require('fs');
const { createServer } = require('http');
const WebSocket = require('ws');
const { getLogger } = require('./utils/logger');

// Initialisation de l'application Express
const app = express();
const port = process.env.PORT || 3000;

// Créer le serveur HTTP
const server = createServer(app);

// Créer le serveur WebSocket
const wss = new WebSocket.Server({ server });

// Initialiser le logger
const logger = getLogger({
  logToFile: true,
  logDir: './logs'
});

// Variables globales pour gérer le processus du bot
let botStatus = 'stopped';

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket - Gestion des connexions
wss.on('connection', (ws) => {
  logger.info('Nouvelle connexion WebSocket établie');
  
  // Envoyer les logs récents lors de la connexion
  logger.getRecentLogs(50).then(logs => {
    ws.send(JSON.stringify({
      type: 'history',
      logs: logs
    }));
  });
  
  // Écouter les nouveaux logs
  const logHandler = (logEntry) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'log',
        data: logEntry
      }));
    }
  };
  
  logger.on('log', logHandler);
  
  // Nettoyer quand la connexion se ferme
  ws.on('close', () => {
    logger.removeListener('log', logHandler);
    logger.info('Connexion WebSocket fermée');
  });
  
  // Gérer les erreurs
  ws.on('error', (error) => {
    logger.error('Erreur WebSocket:', { error: error.message });
  });
});

// Initialiser le configurateur
(async () => {
  await configurator.initialize();
  logger.info('Configurateur initialisé pour l\'interface d\'administration');
})();

// Routes API existantes
app.get('/api/config', (req, res) => {
  try {
    const configs = {};
    
    // Récupérer toutes les configurations
    ['bot', 'personality', 'scenario', 'ai', 'media'].forEach(key => {
      try {
        configs[key] = configurator.getConfig(key);
      } catch (error) {
        logger.error(`Erreur lors de la récupération de la config ${key}:`, { error: error.message });
        configs[key] = { error: error.message };
      }
    });
    
    res.json(configs);
  } catch (error) {
    logger.error('Erreur lors de la récupération des configurations:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/config/:key', (req, res) => {
  try {
    const config = configurator.getConfig(req.params.key);
    res.json(config);
  } catch (error) {
    logger.error(`Configuration ${req.params.key} non trouvée:`, { error: error.message });
    res.status(404).json({ error: error.message });
  }
});

app.post('/api/config/:key', async (req, res) => {
  try {
    configurator.mergeConfig(req.params.key, req.body);
    await configurator.saveConfig(req.params.key);
    logger.info(`Configuration ${req.params.key} mise à jour`);
    res.json({ success: true });
  } catch (error) {
    logger.error(`Erreur lors de la sauvegarde de la config ${req.params.key}:`, { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/profiles', (req, res) => {
  try {
    const personalityConfig = configurator.getConfig('personality');
    const profiles = Object.keys(personalityConfig.profiles);
    res.json({ profiles });
  } catch (error) {
    logger.error('Erreur lors de la récupération des profils:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/scenarios', (req, res) => {
  try {
    const scenarioConfig = configurator.getConfig('scenario');
    const scenarios = Object.keys(scenarioConfig.scenarios);
    res.json({ scenarios });
  } catch (error) {
    logger.error('Erreur lors de la récupération des scénarios:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/active-config', (req, res) => {
  try {
    const botConfig = configurator.getConfig('bot');
    res.json({
      activeProfile: botConfig.behavior.activeProfile,
      activeScenario: botConfig.scenario.active
    });
  } catch (error) {
    logger.error('Erreur lors de la récupération de la config active:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/active-config', async (req, res) => {
  try {
    if (req.body.activeProfile) {
      configurator.setValue('bot', 'behavior.activeProfile', req.body.activeProfile);
    }
    
    if (req.body.activeScenario) {
      configurator.setValue('bot', 'scenario.active', req.body.activeScenario);
    }
    
    await configurator.saveConfig('bot');
    logger.info('Configuration active mise à jour', { 
      profile: req.body.activeProfile, 
      scenario: req.body.activeScenario 
    });
    res.json({ success: true });
  } catch (error) {
    logger.error('Erreur lors de la mise à jour de la config active:', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// Nouvelles routes API pour contrôler le bot
app.post('/api/bot/start', async (req, res) => {
  try {
    if (botStatus === 'running') {
      logger.warn('Tentative de démarrage du bot déjà en cours d\'exécution');
      return res.json({ 
        success: false, 
        message: 'Le bot est déjà en cours d\'exécution',
        status: botStatus 
      });
    }

    logger.info('Démarrage du bot...');
    
    // Au lieu de spawn, on utilise le module bot directement
    const bot = require('./bot/index');
    
    // Mettre à jour le logger du bot
    if (bot.setLogger) {
      bot.setLogger(logger);
    }
    
    // Démarrer le bot de manière asynchrone
    bot.initializeBot().then(() => {
      logger.info('Bot démarré avec succès');
      botStatus = 'running';
    }).catch(error => {
      logger.error('Erreur lors du démarrage du bot:', { error: error.message });
      botStatus = 'stopped';
    });
    
    // Répondre immédiatement
    res.json({ 
      success: true, 
      message: 'Démarrage du bot en cours...',
      status: 'starting' 
    });
    
  } catch (error) {
    logger.error('Erreur lors du démarrage du bot:', { error: error.message });
    res.status(500).json({ 
      success: false, 
      error: error.message,
      status: botStatus 
    });
  }
});

app.post('/api/bot/stop', async (req, res) => {
  try {
    if (botStatus === 'stopped') {
      logger.warn('Tentative d\'arrêt du bot déjà arrêté');
      return res.json({ 
        success: false, 
        message: 'Le bot n\'est pas en cours d\'exécution',
        status: botStatus 
      });
    }

    logger.info('Arrêt du bot...');
    
    const bot = require('./bot/index');
    await bot.stopBot();
    
    botStatus = 'stopped';
    logger.info('Bot arrêté avec succès');
    
    res.json({ 
      success: true, 
      message: 'Bot arrêté avec succès',
      status: botStatus 
    });
    
  } catch (error) {
    logger.error('Erreur lors de l\'arrêt du bot:', { error: error.message });
    res.status(500).json({ 
      success: false, 
      error: error.message,
      status: botStatus 
    });
  }
});

app.get('/api/bot/status', (req, res) => {
  try {
    const bot = require('./bot/index');
    const status = bot.getBotStatus();
    
    res.json({ 
      status: status.isRunning ? 'running' : 'stopped',
      details: status
    });
  } catch (error) {
    logger.error('Erreur lors de la récupération du statut du bot:', { error: error.message });
    res.json({ 
      status: 'unknown',
      error: error.message
    });
  }
});

app.get('/api/bot/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const logs = await logger.getRecentLogs(limit);
    res.json({ logs });
  } catch (error) {
    logger.error('Erreur lors de la récupération des logs:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Interface utilisateur statique
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Démarrer le serveur HTTP et WebSocket
server.listen(port, () => {
  logger.info(`Interface d'administration démarrée sur http://localhost:${port}`);
});

// Gestion propre de l'arrêt
process.on('SIGINT', async () => {
  logger.info('Arrêt de l\'interface d\'administration...');
  try {
    const bot = require('./bot/index');
    await bot.stopBot();
  } catch (error) {
    logger.error('Erreur lors de l\'arrêt du bot:', { error: error.message });
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Arrêt de l\'interface d\'administration...');
  try {
    const bot = require('./bot/index');
    await bot.stopBot();
  } catch (error) {
    logger.error('Erreur lors de l\'arrêt du bot:', { error: error.message });
  }
  process.exit(0);
});

module.exports = server;