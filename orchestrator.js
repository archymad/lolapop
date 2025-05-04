/**
 * Orchestrateur principal pour gérer le démarrage des composants
 * Gère le serveur NLP, l'interface admin et le bot WhatsApp
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const { getLogger } = require('./utils/logger');

class Orchestrator {
  constructor() {
    this.processes = {
      nlp: null,
      admin: null,
      bot: null
    };
    
    this.config = {
      nlpPort: process.env.FLASK_PORT || 5000,
      adminPort: process.env.ADMIN_PORT || 3000,
      nlpCommand: process.platform === 'win32' ? 'python' : 'python3'
    };
    
    this.botStatus = 'stopped';
    
    // Initialiser le logger
    this.logger = getLogger({
      logToFile: true,
      logDir: './logs'
    });
  }

  /**
   * Démarre le serveur NLP
   */
  async startNLPServer() {
    this.logger.info('🚀 Démarrage du serveur NLP...');
    
    return new Promise((resolve, reject) => {
      const nlpProcess = spawn(this.config.nlpCommand, ['ai/model_server.py'], {
        stdio: 'pipe',
        env: { ...process.env, FLASK_PORT: this.config.nlpPort }
      });

      nlpProcess.stdout.on('data', (data) => {
        const message = data.toString().trim();
        this.logger.debug('[NLP Output]', { message });
        if (message.includes('Running on')) {
          this.logger.info('Serveur NLP démarré avec succès', { 
            port: this.config.nlpPort 
          });
          resolve(nlpProcess);
        }
      });

      nlpProcess.stderr.on('data', (data) => {
        const message = data.toString().trim();
        this.logger.error('[NLP Error]', { message });
      });

      nlpProcess.on('error', (error) => {
        this.logger.error('Erreur lors du démarrage du serveur NLP', { 
          error: error.message,
          stack: error.stack 
        });
        reject(error);
      });

      nlpProcess.on('exit', (code, signal) => {
        if (code !== 0) {
          this.logger.error('Le serveur NLP s\'est arrêté de manière inattendue', { 
            code, 
            signal 
          });
        }
      });

      this.processes.nlp = nlpProcess;
    });
  }

  /**
   * Démarre l'interface d'administration
   */
  async startAdminServer() {
    this.logger.info('🚀 Démarrage de l\'interface d\'administration...');
    
    return new Promise((resolve, reject) => {
      const adminProcess = spawn('node', ['admin.js'], {
        stdio: 'pipe',
        env: { ...process.env, PORT: this.config.adminPort }
      });

      adminProcess.stdout.on('data', (data) => {
        const message = data.toString().trim();
        this.logger.debug('[Admin Output]', { message });
        if (message.includes('Interface d\'administration démarrée')) {
          this.logger.info('Interface d\'administration démarrée avec succès', { 
            port: this.config.adminPort,
            url: `http://localhost:${this.config.adminPort}`
          });
          resolve(adminProcess);
        }
      });

      adminProcess.stderr.on('data', (data) => {
        const message = data.toString().trim();
        this.logger.error('[Admin Error]', { message });
      });

      adminProcess.on('error', (error) => {
        this.logger.error('Erreur lors du démarrage de l\'interface admin', { 
          error: error.message,
          stack: error.stack 
        });
        reject(error);
      });

      adminProcess.on('exit', (code, signal) => {
        if (code !== 0) {
          this.logger.error('L\'interface admin s\'est arrêtée de manière inattendue', { 
            code, 
            signal 
          });
        }
      });

      this.processes.admin = adminProcess;
    });
  }

  /**
   * Ouvre le navigateur sur l'interface d'administration
   */
  async openBrowser() {
    const url = `http://localhost:${this.config.adminPort}`;
    this.logger.info('🌐 Ouverture du navigateur', { url });
    
    const start = process.platform === 'darwin' ? 'open' : 
                  process.platform === 'win32' ? 'start' : 'xdg-open';
    
    const { exec } = require('child_process');
    exec(`${start} ${url}`, (error) => {
      if (error) {
        this.logger.error('Erreur lors de l\'ouverture du navigateur', { 
          error: error.message 
        });
      } else {
        this.logger.info('Navigateur ouvert avec succès');
      }
    });
  }

  /**
   * Démarre le bot WhatsApp
   */
  async startBot() {
    this.logger.info('🤖 Démarrage du bot WhatsApp...');
    
    return new Promise((resolve, reject) => {
      const botProcess = spawn('node', ['bot/index.js'], {
        stdio: 'pipe',
        env: process.env
      });

      botProcess.stdout.on('data', (data) => {
        const message = data.toString().trim();
        this.logger.debug('[Bot Output]', { message });
        
        // Détecter les messages importants du bot
        if (message.includes('Client WhatsApp prêt')) {
          this.logger.info('Bot WhatsApp démarré avec succès');
          this.botStatus = 'running';
        } else if (message.includes('QR Code')) {
          this.logger.info('QR Code généré - Scannez avec WhatsApp');
        } else if (message.includes('Authentification réussie')) {
          this.logger.info('Authentification WhatsApp réussie');
        }
      });

      botProcess.stderr.on('data', (data) => {
        const message = data.toString().trim();
        this.logger.error('[Bot Error]', { message });
      });

      botProcess.on('error', (error) => {
        this.logger.error('Erreur lors du démarrage du bot', { 
          error: error.message,
          stack: error.stack 
        });
        reject(error);
      });

      botProcess.on('exit', (code, signal) => {
        this.botStatus = 'stopped';
        if (code !== 0) {
          this.logger.error('Le bot s\'est arrêté de manière inattendue', { 
            code, 
            signal 
          });
        } else {
          this.logger.info('Bot arrêté normalement');
        }
      });

      this.processes.bot = botProcess;
      resolve(botProcess);
    });
  }

  /**
   * Arrête le bot WhatsApp
   */
  async stopBot() {
    if (this.processes.bot) {
      this.logger.info('🛑 Arrêt du bot WhatsApp...');
      this.processes.bot.kill('SIGINT');
      this.processes.bot = null;
      this.botStatus = 'stopped';
      this.logger.info('Bot WhatsApp arrêté avec succès');
    } else {
      this.logger.warn('Tentative d\'arrêt du bot mais aucun processus actif trouvé');
    }
  }

  /**
   * Démarre tous les services sauf le bot
   */
  async startServices() {
    try {
      this.logger.info('🚀 Démarrage des services...');
      
      // Vérifie si Ollama est en cours d'exécution
      await this.checkOllama();
      
      // Démarre le serveur NLP
      await this.startNLPServer();
      this.logger.info('✓ Serveur NLP démarré');
      
      // Démarre l'interface d'administration
      await this.startAdminServer();
      this.logger.info('✓ Interface d\'administration démarrée');
      
      // Attend un peu pour que les serveurs soient bien démarrés
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Ouvre le navigateur
      await this.openBrowser();
      
      this.logger.info('✨ Services démarrés avec succès!', {
        services: {
          nlp: `http://localhost:${this.config.nlpPort}`,
          admin: `http://localhost:${this.config.adminPort}`
        }
      });
      
      this.logger.info('Connectez-vous à l\'interface d\'administration pour configurer et démarrer le bot');
      
    } catch (error) {
      this.logger.error('Erreur lors du démarrage des services', { 
        error: error.message,
        stack: error.stack 
      });
      this.cleanup();
      process.exit(1);
    }
  }

  /**
   * Vérifie si Ollama est en cours d'exécution
   */
  async checkOllama() {
    const http = require('http');
    
    this.logger.info('Vérification du serveur Ollama...');
    
    return new Promise((resolve, reject) => {
      const options = {
        host: 'localhost',
        port: 11434,
        path: '/api/tags',
        timeout: 2000
      };

      const req = http.get(options, (res) => {
        if (res.statusCode === 200) {
          this.logger.info('✓ Ollama est en cours d\'exécution');
          resolve();
        } else {
          const error = new Error('Ollama ne répond pas correctement');
          this.logger.error('Ollama n\'est pas prêt', { 
            statusCode: res.statusCode 
          });
          reject(error);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        const error = new Error('Ollama n\'est pas accessible');
        this.logger.error('Timeout lors de la connexion à Ollama');
        reject(error);
      });

      req.on('error', (error) => {
        this.logger.error('Ollama n\'est pas démarré', { 
          error: error.message,
          solution: 'Veuillez exécuter "ollama serve" dans un autre terminal'
        });
        reject(new Error('Ollama n\'est pas démarré. Veuillez exécuter "ollama serve" dans un autre terminal.'));
      });
    });
  }

  /**
   * Nettoie les processus en cours
   */
  cleanup() {
    this.logger.info('🧹 Nettoyage des processus...');
    
    Object.entries(this.processes).forEach(([name, process]) => {
      if (process) {
        this.logger.info(`Arrêt de ${name}...`);
        try {
          process.kill('SIGINT');
          this.logger.info(`${name} arrêté avec succès`);
        } catch (error) {
          this.logger.error(`Erreur lors de l'arrêt de ${name}`, { 
            error: error.message 
          });
        }
      }
    });
  }

  /**
   * Gère les signaux d'arrêt
   */
  setupSignalHandlers() {
    process.on('SIGINT', () => {
      this.logger.info('✋ Signal SIGINT reçu - Arrêt demandé');
      this.cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      this.logger.info('✋ Signal SIGTERM reçu - Arrêt demandé');
      this.cleanup();
      process.exit(0);
    });

    process.on('uncaughtException', (error) => {
      this.logger.error('Exception non gérée', { 
        error: error.message,
        stack: error.stack 
      });
      this.cleanup();
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Promesse rejetée non gérée', { 
        reason: reason,
        promise: promise 
      });
    });
  }

  /**
   * Obtient les statistiques du système
   */
  getSystemStats() {
    const stats = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      processes: {}
    };
    
    Object.entries(this.processes).forEach(([name, process]) => {
      stats.processes[name] = {
        running: !!process,
        pid: process ? process.pid : null
      };
    });
    
    return stats;
  }
}

// Fonction principale
async function main() {
  console.log(chalk.cyan('╔════════════════════════════════════════╗'));
  console.log(chalk.cyan('║        Bot Conversationnel - Lola      ║'));
  console.log(chalk.cyan('╚════════════════════════════════════════╝'));
  console.log();
  
  const orchestrator = new Orchestrator();
  
  // Configure les gestionnaires de signaux
  orchestrator.setupSignalHandlers();
  
  // Log le démarrage du système
  orchestrator.logger.info('Démarrage du système de bot conversationnel', {
    platform: process.platform,
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development'
  });
  
  // Démarre les services
  await orchestrator.startServices();
  
  // Expose l'orchestrateur pour l'API
  global.orchestrator = orchestrator;
  
  // Affiche les statistiques toutes les minutes
  setInterval(() => {
    const stats = orchestrator.getSystemStats();
    orchestrator.logger.debug('Statistiques système', stats);
  }, 60000);
}

// Démarre l'application
if (require.main === module) {
  main().catch(error => {
    console.error(chalk.red('Erreur fatale:'), error);
    process.exit(1);
  });
}

module.exports = Orchestrator;