/**
 * Point d'entrée principal du bot WhatsApp
 * Ce script initialise le client WhatsApp et gère les interactions
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const configurator = require('../configurator');
const { loadStepProcessor } = require('./stepProcessor');

// Initialisation asynchrone
async function initializeBot() {
  console.log('Initialisation du bot conversationnel...');
  
  // Initialiser le configurateur
  await configurator.initialize();
  
  // Récupérer les configurations
  const botConfig = configurator.getConfig('bot');
  
  // Initialiser le processeur d'étapes avec le configurateur
  const stepProcessor = loadStepProcessor(configurator);
  
  // Configuration du client WhatsApp
  const client = new Client({
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
  
  // Map pour stocker les sessions utilisateur
  const sessions = new Map();
  
  // Événements WhatsApp
  client.on('qr', (qr) => {
    console.log('QR Code reçu:');
    qrcode.generate(qr, { small: true });
    console.log('Scannez ce QR Code avec WhatsApp pour vous connecter');
  });
  
  client.on('ready', () => {
    console.log('Client WhatsApp prêt et connecté!');
    console.log(`Bot démarré avec profil: ${botConfig.behavior?.activeProfile || 'default'}, scénario: ${botConfig.scenario?.active || 'lola_scenario'}`);
  });
  
  client.on('authenticated', () => {
    console.log('Authentification réussie');
  });
  
  client.on('message', async (message) => {
    try {
      // Ignorer les messages de statut et les broadcasts
      if (message.isStatus || message.from === 'status@broadcast') return;
      
      const chatId = message.from;
      const messageContent = message.body.trim();
      
      // Obtenir ou créer une session pour ce chat
      if (!sessions.has(chatId)) {
        sessions.set(chatId, new Session(chatId));
      }
      const session = sessions.get(chatId);
      session.lastActivity = Date.now();
      
      // Analyser le message avec NLP
      try {
        const response = await fetch(`${process.env.NLP_SERVER_URL || 'http://localhost:5000'}/api/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: messageContent })
        });
        
        if (!response.ok) throw new Error(`Request failed with status code ${response.status}`);
        
        const analysisResult = await response.json();
        
        // Mettre à jour les données utilisateur
        if (analysisResult.contains_location && analysisResult.location_name) {
          session.userData.location = analysisResult.location_name;
        }
        if (analysisResult.contains_age && analysisResult.age_value) {
          session.userData.age = analysisResult.age_value;
        }
        
        // Obtenir l'étape actuelle
        const currentStep = stepProcessor.getStepById(session.currentStep);
        
        // Passer à l'étape suivante (simplifié pour l'exemple)
        const nextStep = currentStep?.transitions?.onSuccess || 'step2';
        console.log(`Passage de l'étape ${session.currentStep} à ${nextStep}`);
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
          }
          
          // Personnaliser le message avec les données utilisateur
          content = stepProcessor.personalizeMessage(content, session.userData);
          
          // Ajouter des typos aléatoires pour un effet plus naturel
          content = addRandomTypos(content);
          
          // Délai avant d'envoyer
          const delay = messageObj.delayMs || 3000;
          setTimeout(() => {
            client.sendMessage(chatId, content);
          }, delay);
        }
        
      } catch (nlpError) {
        console.error('Erreur lors de l\'analyse NLP:', nlpError.message);
        
        // Même en cas d'erreur NLP, continuer la conversation
        const currentStep = stepProcessor.getStepById(session.currentStep);
        const nextStep = currentStep?.transitions?.onSuccess || 'step2';
        console.log(`Passage de l'étape ${session.currentStep} à ${nextStep}`);
        session.previousStep = session.currentStep;
        session.currentStep = nextStep;
        
        // Envoyer un message de l'étape suivante
        const newStep = stepProcessor.getStepById(session.currentStep);
        if (newStep && newStep.messages && newStep.messages.length > 0) {
          setTimeout(() => {
            client.sendMessage(chatId, newStep.messages[0].content);
          }, 3000);
        }
      }
      
    } catch (error) {
      console.error('Erreur lors du traitement du message:', error);
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
    for (let i = 0; i < text.length; i++) {
      // Appliquer une typo avec la probabilité définie
      if (Math.random() < typoFrequency) {
        const typoType = typoTypes[Math.floor(Math.random() * typoTypes.length)];
        result += typoType(text[i], i, text);
      } else {
        result += text[i];
      }
    }
    
    return result;
  }
  
  // Nettoyage des sessions inactives
  setInterval(() => {
    const now = Date.now();
    const inactiveTimeout = 30 * 60 * 1000; // 30 minutes
    
    sessions.forEach((session, chatId) => {
      if (now - session.lastActivity > inactiveTimeout) {
        console.log(`Session inactive pour ${chatId}, suppression`);
        sessions.delete(chatId);
      }
    });
  }, 15 * 60 * 1000); // Vérifier toutes les 15 minutes
  
  // Initialiser WhatsApp
  await client.initialize();
  
  return {
    client,
    sessions
  };
}

// Démarrer le bot
initializeBot().catch(err => {
  console.error('Erreur lors de l\'initialisation du bot:', err);
  process.exit(1);
});