/**
 * Gestionnaire de sessions pour le bot
 */

class ConversationSession {
    constructor(chatId, initialStep = null) {
      this.chatId = chatId;
      this.currentStep = initialStep || 'step_1_source'; // Étape initiale dynamique
      this.previousStep = null;
      this.userData = {
        location: null,
        age: null,
        serviceChoice: null,
        schedulingInfo: null,
        paymentConfirmed: false
      };
      this.lastInteractionTime = Date.now();
      this.messageQueue = []; // Pour gérer les messages en file d'attente
      this.processingQueue = false; // Indicateur de traitement en cours
      this.retryCount = 0; // Nombre de tentatives pour l'étape actuelle
    }
  
    // Ajouter un message à la file d'attente
    addToQueue(message) {
      this.messageQueue.push(message);
    }
  }
  
  class SessionManager {
    constructor(sessionConfig) {
      this.sessions = new Map();
      this.config = sessionConfig || {};
      this.storageMethod = this.config.persistence?.storageMethod || 'memory';
      
      // Charger les sessions si persistence activée
      if (this.config.persistence?.enabled && this.storageMethod === 'file') {
        this.loadSessions();
      }
    }
    
    // Créer une nouvelle session
    createSession(chatId) {
      const session = new ConversationSession(chatId);
      this.sessions.set(chatId, session);
      return session;
    }
    
    // Obtenir une session existante
    getSession(chatId) {
      return this.sessions.get(chatId);
    }
    
    // Mettre à jour une session
    updateSession(chatId, sessionData) {
      this.sessions.set(chatId, sessionData);
      
      // Sauvegarder si la persistence est activée
      if (this.config.persistence?.enabled && this.storageMethod === 'file') {
        this.saveSessions();
      }
      
      return sessionData;
    }
    
    // Supprimer une session
    removeSession(chatId) {
      const result = this.sessions.delete(chatId);
      
      // Sauvegarder si la persistence est activée
      if (result && this.config.persistence?.enabled && this.storageMethod === 'file') {
        this.saveSessions();
      }
      
      return result;
    }
    
    // Obtenir toutes les sessions
    getAllSessions() {
      return this.sessions;
    }
    
    // Obtenir le nombre de sessions actives
    getActiveSessions() {
      return this.sessions;
    }
    
    // Sauvegarder les sessions (si persistence fichier)
    saveSessions() {
      if (this.storageMethod !== 'file') return;
      
      try {
        const storagePath = this.config.persistence?.storagePath || './sessions/';
        const fs = require('fs');
        const path = require('path');
        
        // Créer le dossier s'il n'existe pas
        if (!fs.existsSync(storagePath)) {
          fs.mkdirSync(storagePath, { recursive: true });
        }
        
        // Convertir les sessions en format JSON
        const sessionsData = {};
        this.sessions.forEach((session, chatId) => {
          sessionsData[chatId] = {
            currentStep: session.currentStep,
            previousStep: session.previousStep,
            userData: session.userData,
            lastInteractionTime: session.lastInteractionTime,
            retryCount: session.retryCount
          };
        });
        
        // Écrire dans le fichier
        fs.writeFileSync(
          path.join(storagePath, 'sessions.json'),
          JSON.stringify(sessionsData, null, 2),
          'utf8'
        );
      } catch (error) {
        console.error('Erreur lors de la sauvegarde des sessions:', error);
      }
    }
    
    // Charger les sessions (si persistence fichier)
    loadSessions() {
      if (this.storageMethod !== 'file') return;
      
      try {
        const storagePath = this.config.persistence?.storagePath || './sessions/';
        const fs = require('fs');
        const path = require('path');
        const sessionsFile = path.join(storagePath, 'sessions.json');
        
        if (!fs.existsSync(sessionsFile)) return;
        
        // Lire le fichier de sessions
        const sessionsData = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
        
        // Recréer les sessions
        Object.entries(sessionsData).forEach(([chatId, data]) => {
          const session = new ConversationSession(chatId);
          session.currentStep = data.currentStep;
          session.previousStep = data.previousStep;
          session.userData = data.userData;
          session.lastInteractionTime = data.lastInteractionTime;
          session.retryCount = data.retryCount;
          
          this.sessions.set(chatId, session);
        });
        
        console.log(`${this.sessions.size} sessions chargées`);
      } catch (error) {
        console.error('Erreur lors du chargement des sessions:', error);
      }
    }
  }
  
  module.exports = SessionManager;
