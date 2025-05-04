/**
 * Point d'entrée principal du bot WhatsApp
 * Ce script initialise le client WhatsApp et gère les interactions
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const configurator = require('../configurator');
const { loadStepProcessor } = require('./stepProcessor');
const { getLogger } = require('../utils/logger');

// Variable globale pour stocker l'instance du client
let client = null;
let sessions = new Map();
let isRunning = false;
let logger = null;

// Fonction pour définir le logger
function setLogger(customLogger) {
  logger = customLogger;
}

// Fonction pour obtenir le logger
function getLoggerInstance() {
  if (!logger) {
    logger = getLogger({
      logToFile: true,
      logDir: './logs'
    });
  }
  return logger;
}

// Fonction d'initialisation asynchrone
async function initializeBot() {
  const log = getLoggerInstance();
  
  if (isRunning) {
    log.warn('Le bot est déjà en cours d\'exécution');
    return { client, sessions };
  }

  log.info('Initialisation du bot conversationnel...');
  
  try {
    // Initialiser le configurateur
    await configurator.initialize();
    log.info('Configurateur initialisé');
    
    // Récupérer les configurations
    const botConfig = configurator.getConfig('bot');
    log.info('Configuration du bot chargée', {
      profile: botConfig.behavior?.activeProfile,
      scenario: botConfig.scenario?.active
    });
    
    // Initialiser le processeur d'étapes avec le configurateur
    const stepProcessor = loadStepProcessor(configurator);
    log.info('Processeur d\'étapes initialisé');
    
    // Configuration du client WhatsApp
    client = new Client({
      authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
      }),
      puppeteer: {
        headless: botConfig.messaging?.platforms?.whatsapp?.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });
    
    // Créer une classe Session pour gérer les conversations
    class Session {
      constructor(chatId) {
        this.chatId = chatId;
        this.currentStep = 'step1';
        this.previousStep = null;
        this.userData = {};
        this.lastActivity = Date.now();
      }
    }
    
    // Événements WhatsApp
    client.on('qr', (qr) => {
      log.info('QR Code généré - En attente de scan');
      qrcode.generate(qr, { small: true });
      console.log('Scannez ce QR Code avec WhatsApp pour vous connecter');
    });
    
    client.on('ready', () => {
      log.info('Client WhatsApp prêt et connecté', {
        profile: botConfig.behavior?.activeProfile || 'default',
        scenario: botConfig.scenario?.active || 'lola_scenario'
      });
      isRunning = true;
    });
    
    client.on('authenticated', () => {
      log.info('Authentification WhatsApp réussie');
    });
    
    client.on('auth_failure', (message) => {
      log.error('Échec de l\'authentification WhatsApp', { message });
    });
    
    client.on('disconnected', (reason) => {
      log.warn('Déconnexion de WhatsApp', { reason });
      isRunning = false;
    });
    
    client.on('message', async (message) => {
      try {
        // Ignorer les messages de statut et les broadcasts
        if (message.isStatus || message.from === 'status@broadcast') return;
        
        const chatId = message.from;
        const messageContent = message.body.trim();
        
        log.info('Message reçu', {
          chatId: chatId.split('@')[0], // Masquer le domaine pour la confidentialité
          messageLength: messageContent.length,
          hasMedia: message.hasMedia
        });
        
        // Obtenir ou créer une session pour ce chat
        if (!sessions.has(chatId)) {
          sessions.set(chatId, new Session(chatId));
          log.info('Nouvelle session créée', { chatId: chatId.split('@')[0] });
        }
        const session = sessions.get(chatId);
        session.lastActivity = Date.now();
        
        // Analyser le message avec NLP
        try {
          log.debug('Envoi du message au serveur NLP pour analyse');
          
          const response = await fetch(`${process.env.NLP_SERVER_URL || 'http://localhost:5000'}/api/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: messageContent })
          });
          
          if (!response.ok) {
            throw new Error(`Request failed with status code ${response.status}`);
          }
          
          const analysisResult = await response.json();
          log.debug('Résultat de l\'analyse NLP', { analysisResult });
          
          // Mettre à jour les données utilisateur
          if (analysisResult.contains_location && analysisResult.location_name) {
            session.userData.location = analysisResult.location_name;
            log.info('Localisation détectée', { location: analysisResult.location_name });
          }
          if (analysisResult.contains_age && analysisResult.age_value) {
            session.userData.age = analysisResult.age_value;
            log.info('Âge détecté', { age: analysisResult.age_value });
          }
          
          // Obtenir l'étape actuelle
          const currentStep = stepProcessor.getStepById(session.currentStep);
          
          // Passer à l'étape suivante (simplifié pour l'exemple)
          const nextStep = currentStep?.transitions?.onSuccess || 'step2';
          log.info('Transition d\'étape', {
            from: session.currentStep,
            to: nextStep
          });
          
          session.previousStep = session.currentStep;
          session.currentStep = nextStep;
          
          // Envoyer le message correspondant à la nouvelle étape
          const newStep = stepProcessor.getStepById(session.currentStep);
          if (newStep && newStep.messages && newStep.messages.length > 0) {
            // Sélectionner un message (ou une variation)
            const messageObj = newStep.messages[0];
            let content = messageObj.content;
            
            // Utiliser une variation si disponible
            if (messageObj.variations && messageObj.variations.length > 0 && Math.random() > 0.5) {
              const randomIndex = Math.floor(Math.random() * messageObj.variations.length);
              content = messageObj.variations[randomIndex];
              log.debug('Variation de message sélectionnée', { index: randomIndex });
            }
            
            // Personnaliser le message avec les données utilisateur
            content = stepProcessor.personalizeMessage(content, session.userData);
            
            // Ajouter des typos aléatoires pour un effet plus naturel
            content = addRandomTypos(content);
            
            // Délai avant d'envoyer
            const delay = messageObj.delayMs || 3000;
            log.debug('Envoi de réponse programmé', { delay });
            
            setTimeout(() => {
              client.sendMessage(chatId, content).then(() => {
                log.info('Message envoyé', {
                  chatId: chatId.split('@')[0],
                  messageLength: content.length
                });
              }).catch(error => {
                log.error('Erreur lors de l\'envoi du message', {
                  error: error.message,
                  chatId: chatId.split('@')[0]
                });
              });
            }, delay);
          }
          
        } catch (nlpError) {
          log.error('Erreur lors de l\'analyse NLP', { error: nlpError.message });
          
          // Même en cas d'erreur NLP, continuer la conversation
          const currentStep = stepProcessor.getStepById(session.currentStep);
          const nextStep = currentStep?.transitions?.onSuccess || 'step2';
          log.info('Fallback - Passage à l\'étape suivante sans analyse NLP', {
            from: session.currentStep,
            to: nextStep
          });
          
          session.previousStep = session.currentStep;
          session.currentStep = nextStep;
          
          // Envoyer un message de l'étape suivante
          const newStep = stepProcessor.getStepById(session.currentStep);
          if (newStep && newStep.messages && newStep.messages.length > 0) {
            setTimeout(() => {
              client.sendMessage(chatId, newStep.messages[0].content).then(() => {
                log.info('Message de fallback envoyé');
              }).catch(error => {
                log.error('Erreur lors de l\'envoi du message de fallback', {
                  error: error.message
                });
              });
            }, 3000);
          }
        }
        
      } catch (error) {
        log.error('Erreur lors du traitement du message', {
          error: error.message,
          stack: error.stack
        });
      }
    });
    
    // Ajouter des typos aléatoires pour un effet plus naturel
    function addRandomTypos(text) {
      if (!botConfig.behavior?.randomization?.typosEnabled) {
        return text;
      }
      
      const typoFrequency = botConfig.behavior?.randomization?.typosFrequency || 0.05;
      
      // Types de typos
      const typoTypes = [
        // Doublement de lettres
        (char) => char + char,
        // Inversion avec lettre suivante
        (char, i, text) => i < text.length - 1 ? text[i+1] + char : char,
        // Omission de lettre
        () => '',
        // Remplacement par une lettre proche sur clavier
        (char) => {
          const keyboardNeighbors = {
            'a': 'qzs', 'e': 'rzd', 'i': 'uo', 'o': 'iplk',
            't': 'ry', 's': 'dzaq', 'n': 'bhj'
          };
          const neighbors = keyboardNeighbors[char.toLowerCase()];
          if (!neighbors) return char;
          return neighbors.charAt(Math.floor(Math.random() * neighbors.length));
        }
      ];
      
      let result = '';
      let typoCount = 0;
      
      for (let i = 0; i < text.length; i++) {
        // Appliquer une typo avec la probabilité définie
        if (Math.random() < typoFrequency) {
          const typoType = typoTypes[Math.floor(Math.random() * typoTypes.length)];
          result += typoType(text[i], i, text);
          typoCount++;
        } else {
          result += text[i];
        }
      }
      
      if (typoCount > 0) {
        log.debug('Typos ajoutés au message', { count: typoCount });
      }
      
      return result;
    }
    
    // Nettoyage des sessions inactives
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      const inactiveTimeout = 30 * 60 * 1000; // 30 minutes
      let cleanedCount = 0;
      
      sessions.forEach((session, chatId) => {
        if (now - session.lastActivity > inactiveTimeout) {
          sessions.delete(chatId);
          cleanedCount++;
        }
      });
      
      if (cleanedCount > 0) {
        log.info('Sessions inactives nettoyées', { count: cleanedCount });
      }
    }, 15 * 60 * 1000); // Vérifier toutes les 15 minutes
    
    // Initialiser WhatsApp
    log.info('Initialisation du client WhatsApp...');
    await client.initialize();
    
    return {
      client,
      sessions,
      cleanupInterval
    };
    
  } catch (error) {
    log.error('Erreur fatale lors de l\'initialisation du bot', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Fonction pour arrêter le bot proprement
async function stopBot() {
  const log = getLoggerInstance();
  
  if (!isRunning) {
    log.warn('Tentative d\'arrêt du bot alors qu\'il n\'est pas en cours d\'exécution');
    return;
  }

  log.info('Début de la procédure d\'arrêt du bot...');
  
  try {
    if (client) {
      await client.destroy();
      client = null;
      log.info('Client WhatsApp détruit avec succès');
    }
    
    // Nettoyer les sessions
    const sessionCount = sessions.size;
    sessions.clear();
    log.info('Sessions nettoyées', { count: sessionCount });
    
    isRunning = false;
    log.info('Bot arrêté avec succès');
  } catch (error) {
    log.error('Erreur lors de l\'arrêt du bot', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Fonction pour obtenir le statut du bot
function getBotStatus() {
  const status = {
    isRunning,
    sessionsCount: sessions.size,
    clientState: client ? client.info : null
  };
  
  getLoggerInstance().debug('Statut du bot demandé', status);
  
  return status;
}

// Si le script est exécuté directement (pas importé comme module)
if (require.main === module) {
  const log = getLoggerInstance();
  
  // Démarrer le bot
  initializeBot().catch(err => {
    log.error('Erreur lors de l\'initialisation du bot (main)', {
      error: err.message,
      stack: err.stack
    });
    process.exit(1);
  });

  // Gestion propre de l'arrêt
  process.on('SIGINT', async () => {
    log.info('Signal SIGINT reçu');
    await stopBot();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    log.info('Signal SIGTERM reçu');
    await stopBot();
    process.exit(0);
  });
}

// Exporter les fonctions pour un usage externe
module.exports = {
  initializeBot,
  stopBot,
  getBotStatus,
  setLogger,
  client,
  sessions
};