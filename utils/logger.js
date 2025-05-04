/**
 * Système de logs centralisé pour le bot
 * Permet l'envoi des logs en temps réel via WebSocket
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class Logger extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      logToFile: options.logToFile !== false,
      logDir: options.logDir || './logs',
      maxFileSize: options.maxFileSize || 5 * 1024 * 1024, // 5MB
      maxFiles: options.maxFiles || 5
    };
    
    this.currentLogFile = null;
    this.logQueue = [];
    this.processing = false;
    
    // Créer le dossier des logs s'il n'existe pas
    if (this.options.logToFile && !fs.existsSync(this.options.logDir)) {
      fs.mkdirSync(this.options.logDir, { recursive: true });
    }
    
    this.initLogFile();
  }
  
  initLogFile() {
    if (!this.options.logToFile) return;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.currentLogFile = path.join(this.options.logDir, `bot-${timestamp}.log`);
  }
  
  log(level, message, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata
    };
    
    // Émettre l'événement pour les listeners (WebSocket, etc.)
    this.emit('log', logEntry);
    
    // Ajouter à la file d'attente pour l'écriture dans le fichier
    if (this.options.logToFile) {
      this.logQueue.push(logEntry);
      this.processLogQueue();
    }
    
    // Afficher dans la console
    this.consoleLog(level, message, metadata);
  }
  
  consoleLog(level, message, metadata) {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    
    switch (level) {
      case 'error':
        console.error(prefix, message, metadata);
        break;
      case 'warn':
        console.warn(prefix, message, metadata);
        break;
      case 'info':
        console.info(prefix, message, metadata);
        break;
      case 'debug':
        console.debug(prefix, message, metadata);
        break;
      default:
        console.log(prefix, message, metadata);
    }
  }
  
  async processLogQueue() {
    if (this.processing || this.logQueue.length === 0) return;
    
    this.processing = true;
    
    while (this.logQueue.length > 0) {
      const entry = this.logQueue.shift();
      const logLine = JSON.stringify(entry) + '\n';
      
      try {
        await fs.promises.appendFile(this.currentLogFile, logLine);
        
        // Vérifier la taille du fichier
        const stats = await fs.promises.stat(this.currentLogFile);
        if (stats.size > this.options.maxFileSize) {
          await this.rotateLogFile();
        }
      } catch (error) {
        console.error('Erreur lors de l\'écriture du log:', error);
      }
    }
    
    this.processing = false;
  }
  
  async rotateLogFile() {
    // Rotation des fichiers de log
    const files = await fs.promises.readdir(this.options.logDir);
    const logFiles = files
      .filter(file => file.startsWith('bot-') && file.endsWith('.log'))
      .sort()
      .reverse();
    
    // Supprimer les anciens fichiers si nécessaire
    if (logFiles.length >= this.options.maxFiles) {
      const filesToDelete = logFiles.slice(this.options.maxFiles - 1);
      for (const file of filesToDelete) {
        await fs.promises.unlink(path.join(this.options.logDir, file));
      }
    }
    
    // Créer un nouveau fichier de log
    this.initLogFile();
  }
  
  // Méthodes de commodité
  info(message, metadata = {}) {
    this.log('info', message, metadata);
  }
  
  error(message, metadata = {}) {
    this.log('error', message, metadata);
  }
  
  warn(message, metadata = {}) {
    this.log('warn', message, metadata);
  }
  
  debug(message, metadata = {}) {
    this.log('debug', message, metadata);
  }
  
  // Récupérer les derniers logs
  async getRecentLogs(limit = 100) {
    if (!this.currentLogFile || !fs.existsSync(this.currentLogFile)) {
      return [];
    }
    
    try {
      const content = await fs.promises.readFile(this.currentLogFile, 'utf8');
      const lines = content.trim().split('\n');
      const logs = lines
        .slice(-limit)
        .map(line => {
          try {
            return JSON.parse(line);
          } catch (error) {
            return null;
          }
        })
        .filter(log => log !== null);
      
      return logs;
    } catch (error) {
      console.error('Erreur lors de la lecture des logs:', error);
      return [];
    }
  }
}

// Singleton pour le logger
let loggerInstance = null;

function getLogger(options = {}) {
  if (!loggerInstance) {
    loggerInstance = new Logger(options);
  }
  return loggerInstance;
}

module.exports = {
  Logger,
  getLogger
};