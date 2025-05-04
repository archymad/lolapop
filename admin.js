/**
 * Interface d'administration web pour le bot conversationnel
 */

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const configurator = require('./configurator');
const fs = require('fs');

// Initialisation de l'application Express
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialiser le configurateur
(async () => {
  await configurator.initialize();
  console.log('Configurateur initialisé pour l\'interface d\'administration');
})();

// Routes API
app.get('/api/config', (req, res) => {
  try {
    const configs = {};
    
    // Récupérer toutes les configurations
    ['bot', 'personality', 'scenario', 'ai', 'media'].forEach(key => {
      try {
        configs[key] = configurator.getConfig(key);
      } catch (error) {
        console.error(`Erreur lors de la récupération de la config ${key}:`, error);
        configs[key] = { error: error.message };
      }
    });
    
    res.json(configs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/config/:key', (req, res) => {
  try {
    const config = configurator.getConfig(req.params.key);
    res.json(config);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.post('/api/config/:key', async (req, res) => {
  try {
    configurator.mergeConfig(req.params.key, req.body);
    await configurator.saveConfig(req.params.key);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/profiles', (req, res) => {
  try {
    const personalityConfig = configurator.getConfig('personality');
    const profiles = Object.keys(personalityConfig.profiles);
    res.json({ profiles });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/scenarios', (req, res) => {
  try {
    const scenarioConfig = configurator.getConfig('scenario');
    const scenarios = Object.keys(scenarioConfig.scenarios);
    res.json({ scenarios });
  } catch (error) {
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
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Interface utilisateur statique
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Démarrer le serveur
app.listen(port, () => {
  console.log(`Interface d'administration démarrée sur http://localhost:${port}`);
});